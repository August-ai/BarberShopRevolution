#!/usr/bin/env python3
import argparse
import json
import os
import sys
import traceback
import io as _io

import cv2
import mediapipe as mp
import numpy as np

sys.stdout = _io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.stderr = _io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")


def log(message: str) -> None:
    print(message, file=sys.stderr)


def emit_json(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False))


def fail_and_exit(message: str) -> None:
    emit_json({"error": message})
    log(f"ERROR: {message}")
    sys.exit(1)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Scale the source portrait to match the reference face size using facial landmarks."
    )
    parser.add_argument("source_path", help="Path to image 1, the person to edit.")
    parser.add_argument("reference_path", help="Path to image 2, the reference person.")
    parser.add_argument("output_path", help="Path to the fitted output image.")
    parser.add_argument(
        "--min-scale",
        dest="min_scale",
        type=float,
        default=0.72,
        help="Lower clamp for the applied zoom scale."
    )
    parser.add_argument(
        "--max-scale",
        dest="max_scale",
        type=float,
        default=1.45,
        help="Upper clamp for the applied zoom scale."
    )
    return parser.parse_args()


def load_bgr_image(image_path: str) -> np.ndarray:
    image = cv2.imread(image_path, cv2.IMREAD_COLOR)

    if image is None:
        raise RuntimeError(f"Could not open image: {image_path}")

    return image


def detect_face_geometry(face_mesh, bgr_image: np.ndarray) -> dict:
    rgb_image = cv2.cvtColor(bgr_image, cv2.COLOR_BGR2RGB)
    results = face_mesh.process(rgb_image)

    if not results.multi_face_landmarks:
        raise RuntimeError("No face landmarks were detected.")

    landmarks = results.multi_face_landmarks[0].landmark
    xs = np.array([landmark.x for landmark in landmarks], dtype=np.float32)
    ys = np.array([landmark.y for landmark in landmarks], dtype=np.float32)

    min_x = float(np.clip(np.min(xs), 0.0, 1.0))
    max_x = float(np.clip(np.max(xs), 0.0, 1.0))
    min_y = float(np.clip(np.min(ys), 0.0, 1.0))
    max_y = float(np.clip(np.max(ys), 0.0, 1.0))
    width = max_x - min_x
    height = max_y - min_y

    if width <= 0.0 or height <= 0.0:
        raise RuntimeError("Detected face landmarks produced an invalid face box.")

    return {
        "center_x": (min_x + max_x) / 2.0,
        "center_y": (min_y + max_y) / 2.0,
        "width": width,
        "height": height,
        "size": max(width, height)
    }


def apply_zoom_only_transform(source_bgr: np.ndarray, scale: float, center_x: float, center_y: float) -> np.ndarray:
    image_height, image_width = source_bgr.shape[:2]
    center_x_px = center_x * image_width
    center_y_px = center_y * image_height
    transform = np.array(
        [
            [scale, 0.0, (1.0 - scale) * center_x_px],
            [0.0, scale, (1.0 - scale) * center_y_px]
        ],
        dtype=np.float32
    )

    return cv2.warpAffine(
        source_bgr,
        transform,
        (image_width, image_height),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_REFLECT_101
    )


def fit_source_to_reference(
    source_path: str,
    reference_path: str,
    output_path: str,
    min_scale: float,
    max_scale: float
) -> dict:
    source_bgr = load_bgr_image(source_path)
    reference_bgr = load_bgr_image(reference_path)

    with mp.solutions.face_mesh.FaceMesh(
        static_image_mode=True,
        max_num_faces=1,
        refine_landmarks=True,
        min_detection_confidence=0.5
    ) as face_mesh:
        source_face = detect_face_geometry(face_mesh, source_bgr)
        reference_face = detect_face_geometry(face_mesh, reference_bgr)

    raw_scale = reference_face["size"] / source_face["size"]
    applied_scale = float(np.clip(raw_scale, min_scale, max_scale))
    fitted_bgr = apply_zoom_only_transform(
        source_bgr,
        applied_scale,
        source_face["center_x"],
        source_face["center_y"]
    )

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    success = cv2.imwrite(output_path, fitted_bgr)

    if not success:
        raise RuntimeError(f"Failed to write fitted image to {output_path}")

    return {
        "output_path": output_path,
        "raw_scale": raw_scale,
        "applied_scale": applied_scale,
        "source_face": source_face,
        "reference_face": reference_face
    }


def main() -> None:
    args = parse_args()

    if not os.path.exists(args.source_path):
        fail_and_exit(f"Source image not found: {args.source_path}")

    if not os.path.exists(args.reference_path):
        fail_and_exit(f"Reference image not found: {args.reference_path}")

    log(f"Facial fit source: {args.source_path}")
    log(f"Facial fit reference: {args.reference_path}")
    log(f"Facial fit output: {args.output_path}")

    try:
        result = fit_source_to_reference(
            args.source_path,
            args.reference_path,
            args.output_path,
            args.min_scale,
            args.max_scale
        )
        emit_json(result)
    except Exception as error:
        log("Exception during facial fit:")
        log(traceback.format_exc())
        fail_and_exit(str(error))


if __name__ == "__main__":
    main()

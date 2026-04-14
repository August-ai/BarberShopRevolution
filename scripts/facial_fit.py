#!/usr/bin/env python3
import argparse
import json
import os
import sys
import traceback
import io as _io

import cv2
import numpy as np

from facial_geometry_utils import (
    create_face_mesh,
    detect_face_geometry,
    load_bgr_image,
    load_geometry_file,
)

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
        "--reference-geometry",
        dest="reference_geometry_path",
        default="",
        help="Optional path to cached reference face geometry JSON."
    )
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
    max_scale: float,
    reference_geometry_path: str = ""
) -> dict:
    source_bgr = load_bgr_image(source_path)
    reference_face = None
    reference_face_source = "detected"

    with create_face_mesh() as face_mesh:
        source_face = detect_face_geometry(face_mesh, source_bgr)

        if reference_geometry_path:
            reference_face = load_geometry_file(reference_geometry_path)
            reference_face_source = "cache"
        else:
            reference_bgr = load_bgr_image(reference_path)
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
        "reference_face_source": reference_face_source,
        "reference_geometry_path": reference_geometry_path,
        "source_face": source_face,
        "reference_face": reference_face
    }


def main() -> None:
    args = parse_args()

    if not os.path.exists(args.source_path):
        fail_and_exit(f"Source image not found: {args.source_path}")

    if not os.path.exists(args.reference_path):
        fail_and_exit(f"Reference image not found: {args.reference_path}")

    if args.reference_geometry_path and not os.path.exists(args.reference_geometry_path):
        fail_and_exit(f"Reference geometry file not found: {args.reference_geometry_path}")

    log(f"Facial fit source: {args.source_path}")
    log(f"Facial fit reference: {args.reference_path}")
    log(f"Facial fit output: {args.output_path}")
    if args.reference_geometry_path:
        log(f"Facial fit reference geometry: {args.reference_geometry_path}")

    try:
        result = fit_source_to_reference(
            args.source_path,
            args.reference_path,
            args.output_path,
            args.min_scale,
            args.max_scale,
            args.reference_geometry_path
        )
        emit_json(result)
    except Exception as error:
        log("Exception during facial fit:")
        log(traceback.format_exc())
        fail_and_exit(str(error))


if __name__ == "__main__":
    main()

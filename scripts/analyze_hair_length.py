#!/usr/bin/env python3
import argparse
import io as _io
import json
import os
import sys
import traceback

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python
from mediapipe.tasks.python import vision


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
    parser = argparse.ArgumentParser(description="Estimate visible hair length from a portrait.")
    parser.add_argument("input_path", help="Path to the source image.")
    parser.add_argument(
        "--model",
        dest="model_path",
        required=True,
        help="Path to the MediaPipe hair segmentation TFLite model."
    )
    return parser.parse_args()


def detect_face_metrics(rgb_image: np.ndarray) -> dict:
    with mp.solutions.face_mesh.FaceMesh(
        static_image_mode=True,
        max_num_faces=1,
        refine_landmarks=True,
        min_detection_confidence=0.5
    ) as face_mesh:
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
        "min_x": min_x,
        "max_x": max_x,
        "min_y": min_y,
        "max_y": max_y,
        "center_x": (min_x + max_x) / 2.0,
        "center_y": (min_y + max_y) / 2.0,
        "width": width,
        "height": height
    }


def detect_shoulder_y(rgb_image: np.ndarray) -> tuple[float | None, bool]:
    with mp.solutions.pose.Pose(
        static_image_mode=True,
        model_complexity=1,
        min_detection_confidence=0.5
    ) as pose:
        results = pose.process(rgb_image)

    if not results.pose_landmarks:
        return None, False

    landmarks = results.pose_landmarks.landmark
    left_shoulder = landmarks[mp.solutions.pose.PoseLandmark.LEFT_SHOULDER.value]
    right_shoulder = landmarks[mp.solutions.pose.PoseLandmark.RIGHT_SHOULDER.value]
    visibility_scores = [
        float(getattr(left_shoulder, "visibility", 1.0)),
        float(getattr(right_shoulder, "visibility", 1.0))
    ]

    if max(visibility_scores) < 0.35:
        return None, False

    valid_points = []

    if visibility_scores[0] >= 0.35:
        valid_points.append(float(left_shoulder.y))

    if visibility_scores[1] >= 0.35:
        valid_points.append(float(right_shoulder.y))

    if not valid_points:
        return None, False

    return float(np.mean(valid_points)), True


def build_hair_mask(rgb_image: np.ndarray, model_path: str) -> np.ndarray:
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_image.astype(np.uint8))
    base_options = python.BaseOptions(model_asset_path=model_path)
    options = vision.ImageSegmenterOptions(
        base_options=base_options,
        output_category_mask=True
    )

    with vision.ImageSegmenter.create_from_options(options) as segmenter:
        result = segmenter.segment(mp_image)

    if getattr(result, "category_mask", None) is None:
        raise RuntimeError("The segmenter did not return a category mask.")

    category_mask = result.category_mask.numpy_view()
    hair_mask = (category_mask > 0.2).astype(np.float32)
    hair_mask = cv2.GaussianBlur(hair_mask, (15, 15), 0)
    return (hair_mask > 0.16).astype(np.uint8)


def select_primary_hair_component(binary_mask: np.ndarray, face_metrics: dict) -> np.ndarray:
    image_height, image_width = binary_mask.shape[:2]
    component_mask = np.zeros_like(binary_mask, dtype=np.uint8)
    labels_count, labels, stats, _ = cv2.connectedComponentsWithStats(binary_mask, connectivity=8)

    if labels_count <= 1:
        return binary_mask

    anchor_x1 = max(0, int((face_metrics["min_x"] - face_metrics["width"] * 0.45) * image_width))
    anchor_x2 = min(image_width, int((face_metrics["max_x"] + face_metrics["width"] * 0.45) * image_width))
    anchor_y1 = max(0, int((face_metrics["min_y"] - face_metrics["height"] * 0.35) * image_height))
    anchor_y2 = min(image_height, int((face_metrics["max_y"] + face_metrics["height"] * 0.4) * image_height))
    anchor_region = labels[anchor_y1:anchor_y2, anchor_x1:anchor_x2]
    candidate_labels = set(int(label) for label in np.unique(anchor_region).tolist() if int(label) > 0)

    if not candidate_labels:
        candidate_labels = set(range(1, labels_count))

    best_label = None
    best_area = -1

    for label in candidate_labels:
        area = int(stats[label, cv2.CC_STAT_AREA])

        if area > best_area:
            best_area = area
            best_label = label

    if best_label is None:
        return binary_mask

    component_mask[labels == best_label] = 1
    return component_mask


def classify_visible_length(
    hair_bottom_px: int,
    chin_y_px: float,
    shoulder_y_px: float,
    face_height_px: float
) -> tuple[str, str]:
    if hair_bottom_px <= chin_y_px + (face_height_px * 0.18):
        return "short", "chin-or-shorter"

    if hair_bottom_px <= shoulder_y_px + (face_height_px * 0.35):
        return "medium", "shoulder-or-collarbone"

    return "long", "below-shoulder"


def analyze_hair_length(input_path: str, model_path: str) -> dict:
    bgr_image = cv2.imread(input_path, cv2.IMREAD_COLOR)

    if bgr_image is None:
        raise RuntimeError(f"Could not open input image: {input_path}")

    rgb_image = cv2.cvtColor(bgr_image, cv2.COLOR_BGR2RGB).astype(np.uint8)
    image_height, image_width = rgb_image.shape[:2]
    face_metrics = detect_face_metrics(rgb_image)
    shoulder_y, used_pose_shoulders = detect_shoulder_y(rgb_image)
    hair_mask = build_hair_mask(rgb_image, model_path)
    primary_hair_mask = select_primary_hair_component(hair_mask, face_metrics)
    hair_pixels = np.column_stack(np.where(primary_hair_mask > 0))

    if hair_pixels.size == 0:
        raise RuntimeError("Unable to isolate a visible hair region.")

    hair_bottom_px = int(np.max(hair_pixels[:, 0]))
    face_height_px = max(1.0, face_metrics["height"] * image_height)
    chin_y_px = float(face_metrics["max_y"] * image_height)
    shoulder_y_px = float(shoulder_y * image_height) if shoulder_y is not None else float(chin_y_px + (face_height_px * 1.5))
    length_category, length_label = classify_visible_length(
        hair_bottom_px,
        chin_y_px,
        shoulder_y_px,
        face_height_px
    )

    return {
        "lengthCategory": length_category,
        "lengthLabel": length_label,
        "metrics": {
            "imageWidth": image_width,
            "imageHeight": image_height,
            "hairBottomY": hair_bottom_px,
            "chinY": round(chin_y_px, 2),
            "shoulderY": round(shoulder_y_px, 2),
            "faceHeight": round(face_height_px, 2),
            "usedPoseShoulders": used_pose_shoulders
        }
    }


def main() -> None:
    args = parse_args()

    if not os.path.exists(args.input_path):
        fail_and_exit(f"Input file not found: {args.input_path}")

    if not os.path.exists(args.model_path):
        fail_and_exit(f"Model file not found: {args.model_path}")

    try:
        emit_json(analyze_hair_length(args.input_path, args.model_path))
    except Exception as error:
        log("Exception during hair length analysis:")
        log(traceback.format_exc())
        fail_and_exit(str(error))


if __name__ == "__main__":
    main()

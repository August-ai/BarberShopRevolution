#!/usr/bin/env python3
import json
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np


def load_bgr_image(image_path: str) -> np.ndarray:
    image = cv2.imread(image_path, cv2.IMREAD_COLOR)

    if image is None:
        raise RuntimeError(f"Could not open image: {image_path}")

    return image


def create_face_mesh():
    return mp.solutions.face_mesh.FaceMesh(
        static_image_mode=True,
        max_num_faces=1,
        refine_landmarks=True,
        min_detection_confidence=0.5
    )


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


def detect_face_geometry_from_path(image_path: str) -> dict:
    with create_face_mesh() as face_mesh:
        return detect_face_geometry(face_mesh, load_bgr_image(image_path))


def load_geometry_file(file_path: str) -> dict:
    with open(file_path, "r", encoding="utf-8") as geometry_file:
        parsed = json.load(geometry_file)

    face = parsed.get("face") if isinstance(parsed, dict) else None

    if not isinstance(face, dict):
        raise RuntimeError(f"Invalid face geometry file: {file_path}")

    return face


def write_geometry_file(file_path: str, payload: dict) -> None:
    output_path = Path(file_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with output_path.open("w", encoding="utf-8") as geometry_file:
        json.dump(payload, geometry_file, indent=2, ensure_ascii=False)
        geometry_file.write("\n")

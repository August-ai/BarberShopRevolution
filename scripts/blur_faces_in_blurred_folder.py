from __future__ import annotations

import json
import shutil
from pathlib import Path

import cv2
import numpy as np


ROOT_DIR = Path(__file__).resolve().parent.parent
STYLES_DIR = ROOT_DIR / "styles"
BLURRED_DIR = ROOT_DIR / "blurred"
MANIFEST_PATH = BLURRED_DIR / "manifest.json"
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}


def detect_primary_face(image_bgr: np.ndarray) -> tuple[int, int, int, int] | None:
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    cascade = cv2.CascadeClassifier(str(Path(cv2.data.haarcascades) / "haarcascade_frontalface_default.xml"))
    faces = cascade.detectMultiScale(
        gray,
        scaleFactor=1.08,
        minNeighbors=5,
        minSize=(80, 80),
    )

    if len(faces) == 0:
        return None

    return max(faces, key=lambda face: face[2] * face[3])


def build_heavy_face_mask(image_shape: tuple[int, int, int], face_box: tuple[int, int, int, int] | None) -> tuple[np.ndarray, str]:
    height, width = image_shape[:2]
    mask = np.zeros((height, width), dtype=np.uint8)

    if face_box is None:
        center = (width // 2, int(height * 0.38))
        axes = (
            max(48, int(width * 0.19)),
            max(62, int(height * 0.24))
        )
        detection_mode = "fallback"
    else:
        x, y, w, h = face_box
        center = (int(x + (w * 0.5)), int(y + (h * 0.54)))
        axes = (
            max(36, int(w * 0.72)),
            max(48, int(h * 0.92))
        )
        detection_mode = "detected"

    cv2.ellipse(mask, center, axes, 0, 0, 360, 255, -1)
    mask = cv2.GaussianBlur(mask, (61, 61), 0)
    return mask, detection_mode


def blur_face_copy(source_path: Path, output_path: Path) -> dict[str, str]:
    image = cv2.imread(str(source_path), cv2.IMREAD_UNCHANGED)

    if image is None:
        raise RuntimeError(f"Unable to read image: {source_path}")

    alpha_channel = None

    if image.ndim == 2:
        image_bgr = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
    elif image.shape[2] == 4:
        alpha_channel = image[:, :, 3]
        image_bgr = image[:, :, :3]
    else:
        image_bgr = image

    face_box = detect_primary_face(image_bgr)
    mask, detection_mode = build_heavy_face_mask(image_bgr.shape, face_box)

    blur_kernel = max(51, int(min(image_bgr.shape[:2]) * 0.11))

    if blur_kernel % 2 == 0:
        blur_kernel += 1

    blurred_bgr = cv2.GaussianBlur(image_bgr, (blur_kernel, blur_kernel), 0)
    mask_float = (mask.astype(np.float32) / 255.0)[:, :, None]
    output_bgr = (blurred_bgr.astype(np.float32) * mask_float) + (image_bgr.astype(np.float32) * (1.0 - mask_float))
    output_bgr = np.clip(output_bgr, 0, 255).astype(np.uint8)

    if alpha_channel is not None:
        output_image = np.dstack((output_bgr, alpha_channel))
    else:
        output_image = output_bgr

    output_path.parent.mkdir(parents=True, exist_ok=True)

    if not cv2.imwrite(str(output_path), output_image):
        raise RuntimeError(f"Unable to write image: {output_path}")

    return {
        "source": source_path.name,
        "output": output_path.name,
        "detectionMode": detection_mode,
        "blurStyle": "heavy-face",
        "sourceFolder": "styles",
        "outputFolder": "blurred"
    }


def remove_stale_blurred_images(style_filenames: set[str]) -> None:
    for blurred_path in BLURRED_DIR.iterdir():
        if not blurred_path.is_file() or blurred_path.suffix.lower() not in IMAGE_EXTENSIONS:
            continue

        if blurred_path.name not in style_filenames:
            blurred_path.unlink(missing_ok=True)


def main() -> None:
    BLURRED_DIR.mkdir(parents=True, exist_ok=True)
    style_image_paths = sorted(
        [
            image_path
            for image_path in STYLES_DIR.iterdir()
            if image_path.is_file() and image_path.suffix.lower() in IMAGE_EXTENSIONS
        ],
        key=lambda image_path: image_path.name.lower()
    )
    remove_stale_blurred_images({image_path.name for image_path in style_image_paths})
    manifest_entries: list[dict[str, str]] = []

    for style_path in style_image_paths:
        blurred_path = BLURRED_DIR / style_path.name
        shutil.copyfile(style_path, blurred_path)
        entry = blur_face_copy(style_path, blurred_path)
        manifest_entries.append(entry)
        print(f"Blurred {style_path.name} ({entry['detectionMode']}).")

    MANIFEST_PATH.write_text(f"{json.dumps(manifest_entries, indent=2)}\n", encoding="utf-8")
    print(f"Wrote manifest to {MANIFEST_PATH}.")


if __name__ == "__main__":
    main()

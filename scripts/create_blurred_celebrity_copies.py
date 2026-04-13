from __future__ import annotations

import json
import re
from pathlib import Path

import cv2
import numpy as np


ROOT_DIR = Path(__file__).resolve().parent.parent
STYLES_DIR = ROOT_DIR / "styles"
BLURRED_DIR = ROOT_DIR / "blurred"
METADATA_PATH = STYLES_DIR / "hairstyles.json"
MANIFEST_PATH = BLURRED_DIR / "manifest.json"

# Only blur files that are explicitly celebrity-linked from local metadata
# or were intentionally added by the user as celebrity references.
EXPLICIT_CELEBRITY_FILENAMES = {
    "Redhair_shoulderHair.png",
}

CELEBRITY_ALIAS_PATTERNS = (
    re.compile(r"\btaylor[-_\s]?swift\b", re.IGNORECASE),
    re.compile(r"\bmatilda[-_\s]?djerf\b", re.IGNORECASE),
)


def load_celebrity_filenames() -> list[str]:
    filenames = set(EXPLICIT_CELEBRITY_FILENAMES)

    if METADATA_PATH.exists():
        items = json.loads(METADATA_PATH.read_text(encoding="utf-8"))

        for item in items:
            filename = str(item.get("filename", "")).strip()
            aliases = " ".join(str(alias or "") for alias in item.get("aliases", []))
            haystack = f"{filename} {aliases}"

            if any(pattern.search(haystack) for pattern in CELEBRITY_ALIAS_PATTERNS):
                filenames.add(filename)

    return sorted(name for name in filenames if (STYLES_DIR / name).exists())


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


def build_face_mask(image_shape: tuple[int, int, int], face_box: tuple[int, int, int, int] | None) -> tuple[np.ndarray, str]:
    height, width = image_shape[:2]
    mask = np.zeros((height, width), dtype=np.uint8)

    if face_box is None:
        center = (width // 2, int(height * 0.38))
        axes = (max(24, int(width * 0.12)), max(30, int(height * 0.14)))
        detection_mode = "fallback"
    else:
        x, y, w, h = face_box
        center = (int(x + (w * 0.5)), int(y + (h * 0.56)))
        # Keep the blur tightly on facial features so the surrounding hair stays intact.
        axes = (max(18, int(w * 0.33)), max(22, int(h * 0.40)))
        detection_mode = "detected"

    cv2.ellipse(mask, center, axes, 0, 0, 360, 255, -1)
    mask = cv2.GaussianBlur(mask, (31, 31), 0)
    return mask, detection_mode


def lightly_blur_face(source_path: Path, destination_path: Path) -> dict[str, str]:
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
    mask, detection_mode = build_face_mask(image_bgr.shape, face_box)

    blur_kernel = max(15, int(min(image_bgr.shape[:2]) * 0.045))

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

    destination_path.parent.mkdir(parents=True, exist_ok=True)

    if not cv2.imwrite(str(destination_path), output_image):
        raise RuntimeError(f"Unable to write image: {destination_path}")

    return {
        "source": source_path.name,
        "output": destination_path.name,
        "detectionMode": detection_mode,
    }


def main() -> None:
    celebrity_filenames = load_celebrity_filenames()
    BLURRED_DIR.mkdir(parents=True, exist_ok=True)

    manifest: list[dict[str, str]] = []

    for filename in celebrity_filenames:
        result = lightly_blur_face(STYLES_DIR / filename, BLURRED_DIR / filename)
        manifest.append(result)
        print(f"Created blurred copy for {filename} ({result['detectionMode']}).")

    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"Wrote manifest to {MANIFEST_PATH}.")


if __name__ == "__main__":
    main()

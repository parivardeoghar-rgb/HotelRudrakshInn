export interface CompressedImageResult {
  dataUrl: string;
  width: number;
  height: number;
  approxBytes: number;
}

const DEFAULT_MAX_DATA_URL_LENGTH = 165000;

function estimateDataUrlBytes(dataUrl: string): number {
  const commaIdx = dataUrl.indexOf(',');
  const base64Len = commaIdx >= 0 ? dataUrl.length - commaIdx - 1 : dataUrl.length;
  return Math.round((base64Len * 3) / 4);
}

function encodeCanvasWithinLimit(
  source: HTMLImageElement | HTMLVideoElement,
  sourceWidth: number,
  sourceHeight: number,
  initialMaxDim = 760,
  maxDataUrlLength = DEFAULT_MAX_DATA_URL_LENGTH
): CompressedImageResult {
  if (!sourceWidth || !sourceHeight) {
    throw new Error('Unable to read image dimensions.');
  }

  let currentMaxDim = initialMaxDim;
  const qualities = [0.78, 0.66, 0.54, 0.42, 0.32];

  for (let pass = 0; pass < 4; pass += 1) {
    const scale = Math.min(1, currentMaxDim / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Browser canvas is unavailable for image processing.');
    }
    ctx.drawImage(source, 0, 0, width, height);

    for (const quality of qualities) {
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      if (dataUrl.length <= maxDataUrlLength) {
        return {
          dataUrl,
          width,
          height,
          approxBytes: estimateDataUrlBytes(dataUrl),
        };
      }
    }

    currentMaxDim = Math.round(currentMaxDim * 0.72);
  }

  throw new Error('Selected photo is too large to optimize. Please choose a smaller image.');
}

export function compressImageFileToDataUrl(
  file: File,
  initialMaxDim = 760,
  maxDataUrlLength = DEFAULT_MAX_DATA_URL_LENGTH
): Promise<CompressedImageResult> {
  if (!file.type.startsWith('image/')) {
    return Promise.reject(new Error('Please select a valid image file (JPG, PNG, or WebP).'));
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the selected image file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Unsupported or corrupted image file.'));
      img.onload = () => {
        try {
          resolve(
            encodeCanvasWithinLimit(
              img,
              img.naturalWidth || img.width,
              img.naturalHeight || img.height,
              initialMaxDim,
              maxDataUrlLength
            )
          );
        } catch (err) {
          reject(err instanceof Error ? err : new Error('Failed to optimize photo.'));
        }
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export function captureVideoFrameToDataUrl(
  video: HTMLVideoElement,
  initialMaxDim = 760,
  maxDataUrlLength = DEFAULT_MAX_DATA_URL_LENGTH
): CompressedImageResult {
  return encodeCanvasWithinLimit(
    video,
    video.videoWidth,
    video.videoHeight,
    initialMaxDim,
    maxDataUrlLength
  );
}

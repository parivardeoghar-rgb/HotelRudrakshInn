import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, CheckCircle2, ImagePlus, Upload, X } from 'lucide-react';
import { attachOrderMealPhoto } from '../services/firestoreService';
import type { Order } from '../types';
import { formatDateTime, formatINR } from '../utils/format';
import {
  captureVideoFrameToDataUrl,
  compressImageFileToDataUrl,
} from '../utils/imageCompression';

interface MealPhotoUploadModalProps {
  open: boolean;
  orders: Order[];
  initialOrderId?: string | null;
  customerUid: string;
  customerName: string;
  onClose: () => void;
  onUploaded: (order: Order) => void;
}

export const MealPhotoUploadModal: React.FC<MealPhotoUploadModalProps> = ({
  open,
  orders,
  initialOrderId,
  customerUid,
  customerName,
  onClose,
  onUploaded,
}) => {
  const eligibleOrders = useMemo(
    () => orders.filter((o) => o.status !== 'Cancelled'),
    [orders]
  );

  const [selectedOrderId, setSelectedOrderId] = useState<string>('');
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [previewSizeKb, setPreviewSizeKb] = useState<number | null>(null);
  const [caption, setCaption] = useState('');
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Live camera viewfinder state
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraFileInputRef = useRef<HTMLInputElement | null>(null);

  const stopCameraStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    setCameraReady(false);
  };

  useEffect(() => {
    if (!open) {
      stopCameraStream();
      return;
    }

    const fallbackId = eligibleOrders[0]?.id || '';
    const targetId =
      initialOrderId && eligibleOrders.some((o) => o.id === initialOrderId)
        ? initialOrderId
        : fallbackId;
    setSelectedOrderId(targetId);

    const targetOrder = eligibleOrders.find((o) => o.id === targetId);
    setPreviewDataUrl(null);
    setPreviewSizeKb(null);
    setCaption(targetOrder?.mealPhotoCaption || '');
    setErrorMsg(null);
    stopCameraStream();
  }, [open, initialOrderId, eligibleOrders]);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        stopCameraStream();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const selectedOrder = useMemo(
    () => eligibleOrders.find((o) => o.id === selectedOrderId) || null,
    [eligibleOrders, selectedOrderId]
  );

  const handleOrderSelectChange = (nextId: string) => {
    setSelectedOrderId(nextId);
    const ord = eligibleOrders.find((o) => o.id === nextId);
    if (!previewDataUrl) {
      setCaption(ord?.mealPhotoCaption || '');
    }
    setErrorMsg(null);
  };

  const handleFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setProcessing(true);
    setErrorMsg(null);
    try {
      const result = await compressImageFileToDataUrl(file);
      setPreviewDataUrl(result.dataUrl);
      setPreviewSizeKb(Math.max(1, Math.round(result.approxBytes / 1024)));
      stopCameraStream();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to process selected photo.');
    } finally {
      setProcessing(false);
    }
  };

  const handleStartCamera = async () => {
    setErrorMsg(null);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      cameraFileInputRef.current?.click();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraActive(true);
      setCameraReady(false);
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => {
            // Safari/iOS may require metadata loaded first
          });
        }
      });
    } catch {
      // Fallback to native mobile/browser camera file input when live stream permission is denied or unavailable
      cameraFileInputRef.current?.click();
    }
  };

  const handleCaptureSnapshot = () => {
    if (!videoRef.current || !cameraReady) return;
    setProcessing(true);
    setErrorMsg(null);
    try {
      const result = captureVideoFrameToDataUrl(videoRef.current);
      setPreviewDataUrl(result.dataUrl);
      setPreviewSizeKb(Math.max(1, Math.round(result.approxBytes / 1024)));
      stopCameraStream();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not capture camera snapshot.');
    } finally {
      setProcessing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrder) {
      setErrorMsg('Please select an order to link this meal photo.');
      return;
    }
    const finalImage = previewDataUrl || selectedOrder.mealPhotoUrl;
    if (!finalImage) {
      setErrorMsg('Please select a meal photo or take one using your camera.');
      return;
    }

    setSaving(true);
    setErrorMsg(null);
    try {
      await attachOrderMealPhoto({
        order: selectedOrder,
        customerUid,
        imageDataUrl: finalImage,
        caption,
        guestName: customerName,
      });
      stopCameraStream();
      onUploaded(selectedOrder);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Unable to save meal photo right now.'
      );
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const displayedPhoto = previewDataUrl || selectedOrder?.mealPhotoUrl || null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="meal-photo-modal-title"
      onClick={() => {
        stopCameraStream();
        onClose();
      }}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
    >
      <form
        onSubmit={(e) => void handleSubmit(e)}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-white rounded-t-2xl sm:rounded-2xl overflow-hidden max-h-[92vh] flex flex-col border border-zinc-200 shadow-2xl"
      >
        <div className="px-5 py-4 bg-[#141518] text-white flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold text-[#D4AF37]">
              Guest Dining Showcase · Management Review
            </div>
            <h3 id="meal-photo-modal-title" className="font-display text-lg font-semibold text-white">
              Upload Your Meal Photo
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Share a photo of your served dishes linked directly to your order record.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close meal photo modal"
            onClick={() => {
              stopCameraStream();
              onClose();
            }}
            className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-zinc-200 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4 flex-1 text-xs">
          {eligibleOrders.length === 0 ? (
            <div className="p-4 rounded-xl bg-zinc-50 border border-zinc-200 text-zinc-600 text-center">
              Place a dining or room service order first to link a meal photo.
            </div>
          ) : (
            <>
              <div>
                <label
                  htmlFor="meal-photo-order-select"
                  className="block font-semibold text-zinc-800 mb-1"
                >
                  Link Photo to Order
                </label>
                <select
                  id="meal-photo-order-select"
                  value={selectedOrderId}
                  onChange={(e) => handleOrderSelectChange(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-300 bg-white font-medium text-zinc-900 focus:outline-none focus:ring-2 focus:ring-[#C59B27]"
                >
                  {eligibleOrders.map((ord) => {
                    const loc = ord.tableNumber
                      ? `Table ${ord.tableNumber}`
                      : ord.roomNumber
                      ? `Room ${ord.roomNumber}`
                      : 'Takeaway';
                    return (
                      <option key={ord.id} value={ord.id}>
                        {ord.orderNumber} · {loc} · {formatINR(ord.subtotal)} ·{' '}
                        {formatDateTime(ord.createdAt)}
                      </option>
                    );
                  })}
                </select>
                {selectedOrder && (
                  <p className="text-[11px] text-zinc-500 mt-1 truncate">
                    Dishes:{' '}
                    {selectedOrder.items.map((it) => `${it.qty}× ${it.name}`).join(', ')}
                  </p>
                )}
              </div>

              {/* Hidden File Inputs */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => void handleFileChosen(e)}
                className="hidden"
              />
              <input
                ref={cameraFileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => void handleFileChosen(e)}
                className="hidden"
              />

              {/* Capture & File Picker Controls */}
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  disabled={processing || saving}
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3.5 py-2.5 rounded-xl border border-zinc-300 bg-white hover:border-[#C59B27] text-zinc-900 font-semibold inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer transition-colors disabled:opacity-60"
                >
                  <Upload className="w-4 h-4 text-[#9A7415]" />
                  <span>Choose Photo</span>
                </button>
                <button
                  type="button"
                  disabled={processing || saving}
                  onClick={() => void handleStartCamera()}
                  className="px-3.5 py-2.5 rounded-xl bg-[#141518] hover:bg-zinc-800 text-[#D4AF37] font-semibold inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer transition-colors disabled:opacity-60"
                >
                  <Camera className="w-4 h-4" />
                  <span>Take Photo</span>
                </button>
              </div>

              {/* Live Camera Viewfinder */}
              {cameraActive && (
                <div className="rounded-xl overflow-hidden border border-zinc-300 bg-black space-y-2 p-2">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    onLoadedMetadata={() => setCameraReady(true)}
                    className="w-full max-h-60 object-cover rounded-lg bg-zinc-900"
                  />
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <button
                      type="button"
                      onClick={stopCameraStream}
                      className="px-3 py-1.5 rounded-lg border border-zinc-600 text-zinc-200 font-semibold cursor-pointer"
                    >
                      Cancel Camera
                    </button>
                    <button
                      type="button"
                      disabled={!cameraReady}
                      onClick={handleCaptureSnapshot}
                      className="px-4 py-1.5 rounded-lg bg-[#C59B27] text-[#141518] font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      <span>{cameraReady ? 'Capture Snapshot' : 'Starting Camera...'}</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Photo Preview */}
              {processing ? (
                <div className="h-44 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 flex items-center justify-center text-zinc-500 font-medium">
                  Optimizing meal photo for upload...
                </div>
              ) : displayedPhoto ? (
                <div className="rounded-xl border border-zinc-200 overflow-hidden bg-zinc-50">
                  <img
                    src={displayedPhoto}
                    alt={`Meal photo for ${selectedOrder?.orderNumber || 'order'}`}
                    className="w-full max-h-64 object-cover bg-zinc-900"
                  />
                  <div className="px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-600 border-t border-zinc-200">
                    <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {previewDataUrl
                        ? `Ready to upload${previewSizeKb ? ` (${previewSizeKb} KB)` : ''}`
                        : `Saved photo · Status: ${selectedOrder?.mealPhotoStatus || 'Pending Review'}`}
                    </span>
                    {previewDataUrl && (
                      <button
                        type="button"
                        onClick={() => {
                          setPreviewDataUrl(null);
                          setPreviewSizeKb(null);
                        }}
                        className="text-zinc-500 hover:text-zinc-900 font-semibold cursor-pointer"
                      >
                        Clear new selection
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="h-40 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 flex flex-col items-center justify-center text-center px-4 gap-2 text-zinc-500">
                  <ImagePlus className="w-7 h-7 text-zinc-400" />
                  <p>
                    Pick a meal photo from your device or take one live with your camera.
                  </p>
                </div>
              )}

              {/* Optional Caption */}
              <div>
                <label
                  htmlFor="meal-photo-caption"
                  className="block font-semibold text-zinc-800 mb-1"
                >
                  Note for Kitchen &amp; Management (Optional)
                </label>
                <input
                  id="meal-photo-caption"
                  type="text"
                  maxLength={160}
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="e.g., Loved the Paneer Tikka presentation & aroma!"
                  className="w-full px-3 py-2 rounded-lg border border-zinc-300 text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-[#C59B27]"
                />
              </div>

              {errorMsg && (
                <div
                  role="alert"
                  className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 font-medium"
                >
                  {errorMsg}
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-4 bg-zinc-50 border-t border-zinc-200 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              stopCameraStream();
              onClose();
            }}
            className="px-4 py-2 rounded-lg border border-zinc-300 bg-white text-xs font-semibold text-zinc-700 hover:text-zinc-900 whitespace-nowrap shrink-0 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={
              saving ||
              processing ||
              eligibleOrders.length === 0 ||
              (!previewDataUrl && !selectedOrder?.mealPhotoUrl)
            }
            className="px-4 py-2 rounded-lg bg-[#141518] hover:bg-zinc-800 text-[#D4AF37] text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
          >
            <Camera className="w-3.5 h-3.5" />
            <span>
              {saving
                ? 'Saving to Order...'
                : selectedOrder?.mealPhotoUrl && !previewDataUrl
                ? 'Update Caption'
                : 'Save Meal Photo'}
            </span>
          </button>
        </div>
      </form>
    </div>
  );
};

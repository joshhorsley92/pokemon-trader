"use client";

import { useState } from "react";

const MAX_PHOTOS = 3;
const MAX_DIMENSION = 1200;
const JPEG_QUALITY = 0.8;

/** Downscale + re-encode to JPEG in the browser so uploads stay small. */
async function compressImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(
    1,
    MAX_DIMENSION / Math.max(bitmap.width, bitmap.height),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

export function PhotoInput({
  photos,
  onChange,
}: {
  photos: string[];
  onChange: (photos: string[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const room = MAX_PHOTOS - photos.length;
      const added: string[] = [];
      for (const file of Array.from(files).slice(0, room)) {
        if (!file.type.startsWith("image/")) continue;
        added.push(await compressImage(file));
      }
      if (added.length > 0) onChange([...photos, ...added]);
    } catch {
      setError("Couldn't read that image — try a different one.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <span className="text-sm font-medium text-emerald-50">
        Photos <span className="text-emerald-100/60">(optional, up to {MAX_PHOTOS})</span>
      </span>
      <p className="text-xs text-emerald-100/60">
        Especially helpful if anything isn&apos;t in perfect shape — it speeds
        up our review.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {photos.map((src, i) => (
          <div key={i} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={`Photo ${i + 1}`}
              className="h-20 w-20 rounded-md object-cover shadow"
            />
            <button
              type="button"
              onClick={() => onChange(photos.filter((_, j) => j !== i))}
              aria-label={`Remove photo ${i + 1}`}
              className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-xs font-bold text-white shadow"
            >
              ×
            </button>
          </div>
        ))}
        {photos.length < MAX_PHOTOS && (
          <label className="flex h-20 w-20 cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed border-emerald-200/40 text-emerald-100/70 hover:border-emerald-200/70 hover:text-white">
            <span className="text-2xl leading-none">+</span>
            <span className="mt-0.5 text-[10px]">{busy ? "adding…" : "add photo"}</span>
            <input
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                void addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-red-300">{error}</p>}
    </div>
  );
}

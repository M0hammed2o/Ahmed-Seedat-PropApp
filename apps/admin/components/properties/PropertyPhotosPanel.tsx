'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';

// Stage 4: property photo upload, reusing the private documents bucket/malware-scan pipeline
// (apps/admin/app/api/v1/properties/[id]/photos/route.ts) -- never a public bucket, never
// hotlinked. Uploads one file at a time (sequential) rather than a single multi-file request so a
// partial failure (one bad file among several) doesn't lose the others -- each succeeds or fails on
// its own and the panel keeps going.

interface PhotoRow {
  id: string;
  documentId: string;
  isCover: boolean;
  fileName: string;
  signedUrl: string | null;
  createdAt: string;
}

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_TYPES = 'image/jpeg,image/png,image/heic,image/webp';

export function PropertyPhotosPanel({
  propertyId,
  canManage,
}: {
  propertyId: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<PhotoRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/v1/properties/${propertyId}/photos`);
      const body = await response.json();
      setPhotos(body.photos ?? []);
    } catch {
      setPhotos([]);
    } finally {
      setLoaded(true);
    }
  }, [propertyId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (file.size > MAX_FILE_SIZE_BYTES) {
          setError(`${file.name} is larger than 10MB — skipped.`);
          continue;
        }
        const form = new FormData();
        form.set('file', file);
        const response = await fetch(`/api/v1/properties/${propertyId}/photos`, {
          method: 'POST',
          body: form,
        });
        if (!response.ok) {
          const body = await response.json();
          setError(body.error?.message ?? `Failed to upload ${file.name}.`);
        }
      }
      await load();
      router.refresh();
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function setCover(photoId: string) {
    setError(null);
    const response = await fetch(`/api/v1/properties/${propertyId}/photos/${photoId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isCover: true }),
    });
    if (!response.ok) {
      const body = await response.json();
      setError(body.error?.message ?? 'Failed to set cover photo.');
      return;
    }
    await load();
    router.refresh();
  }

  async function removePhoto(photoId: string) {
    setError(null);
    const response = await fetch(`/api/v1/properties/${propertyId}/photos/${photoId}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      const body = await response.json();
      setError(body.error?.message ?? 'Failed to remove photo.');
      return;
    }
    await load();
    router.refresh();
  }

  if (!loaded) {
    return <p className="panel py-8 text-center text-sm text-muted-foreground">Loading photos…</p>;
  }

  return (
    <div className="space-y-4">
      {error ? (
        <p className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
          {error}
        </p>
      ) : null}

      {canManage ? (
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_TYPES}
            multiple
            capture="environment"
            onChange={(e) => handleFiles(e.target.files)}
            disabled={uploading}
            className="block text-sm text-foreground"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            JPEG, PNG, WebP, or HEIC, up to 10MB each. On a phone, this can also open the camera.
          </p>
          {uploading ? <p className="mt-1 text-xs text-muted-foreground">Uploading…</p> : null}
        </div>
      ) : null}

      {photos.length === 0 ? (
        <p className="panel py-8 text-center text-sm text-muted-foreground">
          No photos uploaded for this property yet.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {photos.map((p) => (
            <div key={p.id} className="panel overflow-hidden">
              <div className="relative h-40 bg-muted">
                {p.signedUrl ? (
                  <img src={p.signedUrl} alt={p.fileName} className="h-full w-full object-cover" />
                ) : null}
                {p.isCover ? (
                  <span className="absolute top-2 left-2 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
                    Cover
                  </span>
                ) : null}
              </div>
              {canManage ? (
                <div className="flex items-center justify-between gap-2 p-2.5">
                  {!p.isCover ? (
                    <Button size="sm" onClick={() => setCover(p.id)}>
                      Set as cover
                    </Button>
                  ) : (
                    <span />
                  )}
                  <Button size="sm" variant="destructive" onClick={() => removePhoto(p.id)}>
                    Remove
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

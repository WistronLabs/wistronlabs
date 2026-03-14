import { useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import useApi from "../hooks/useApi.jsx";
import useToast from "../hooks/useToast.jsx";
import { AuthContext } from "../context/AuthContext.jsx";
import { useContext } from "react";

const MAX_PHOTO_BYTES = 12 * 1024 * 1024;

export default function PhotoUploadPage() {
  const { serviceTag } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { token } = useContext(AuthContext);
  const tokenFromQr = searchParams.get("t");
  const effectiveToken = tokenFromQr || token;

  const { uploadSystemPhoto } = useApi();
  const { showToast, Toast } = useToast();

  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);

  const canUpload = useMemo(
    () => !!effectiveToken && !!serviceTag && !!selectedFile && !uploading,
    [effectiveToken, serviceTag, selectedFile, uploading],
  );

  const onFileChange = (e) => {
    const file = e.target.files?.[0] || null;
    if (!file) {
      setSelectedFile(null);
      return;
    }
    const allowed = /^(image\/jpeg|image\/png|image\/webp|image\/heic|image\/heif)$/i.test(
      file.type || "",
    );
    if (!allowed) {
      showToast("Unsupported image type", "error", 3000, "bottom-right");
      e.target.value = "";
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      showToast("Image exceeds 12MB limit", "error", 3000, "bottom-right");
      e.target.value = "";
      return;
    }
    setSelectedFile(file);
  };

  const handleUpload = async () => {
    if (!canUpload) return;
    setUploading(true);
    try {
      await uploadSystemPhoto(serviceTag, selectedFile, effectiveToken);
      showToast("Photo uploaded", "success", 2500, "bottom-right");
      setSelectedFile(null);
      navigate(`/${encodeURIComponent(serviceTag)}`);
    } catch (e) {
      const msg = e?.body?.error || e?.message || "Failed to upload photo";
      showToast(msg, "error", 3000, "bottom-right");
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      {uploading && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/35 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-lg border border-gray-200 px-6 py-5 flex items-center gap-3">
            <div className="h-5 w-5 rounded-full border-2 border-blue-600 border-t-transparent animate-spin" />
            <div className="text-sm text-gray-800 font-medium">
              Uploading photo. Please do not leave this page.
            </div>
          </div>
        </div>
      )}
      <main className="md:max-w-xl mx-auto mt-10 bg-white rounded-2xl shadow-lg p-6 space-y-5">
        <Toast />
        <h1 className="text-2xl font-semibold text-gray-800">Add Photo</h1>
        <div className="text-sm text-gray-600">
          Service Tag: <span className="font-semibold text-blue-700">{serviceTag}</span>
        </div>

        {!effectiveToken ? (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            Login is required to upload photos.
            <div className="mt-2">
              <Link to="/auth" className="underline">
                Go to Login
              </Link>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">
                Take Photo / Upload Photo
              </label>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                capture="environment"
                onChange={onFileChange}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
              {selectedFile && (
                <div className="text-xs text-gray-600">
                  Selected: {selectedFile.name}
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleUpload}
                disabled={!canUpload}
                className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2 rounded-lg shadow disabled:opacity-50"
              >
                {uploading ? "Uploading..." : "Upload Photo"}
              </button>
            </div>
          </>
        )}
      </main>
    </>
  );
}

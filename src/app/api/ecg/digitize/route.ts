import { digitizeEcgImage, DigitizerNotConfiguredError } from "@/lib/ecg-digitizer/digitize";

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_SIZE_BYTES) {
    return Response.json({ error: "Image must be 10 MB or smaller." }, { status: 413 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "Request must contain multipart form data." }, { status: 400 });
  }

  const image = formData.get("image");
  if (!(image instanceof File)) {
    return Response.json({ error: 'Upload an image in the "image" field.' }, { status: 400 });
  }
  if (!ALLOWED_IMAGE_TYPES.has(image.type)) {
    return Response.json(
      { error: "Image must be a JPEG, PNG, or WebP file." },
      { status: 415 },
    );
  }
  if (image.size === 0) {
    return Response.json({ error: "Image must not be empty." }, { status: 400 });
  }
  if (image.size > MAX_IMAGE_SIZE_BYTES) {
    return Response.json({ error: "Image must be 10 MB or smaller." }, { status: 413 });
  }

  try {
    const result = await digitizeEcgImage(image);

    // TODO: pass `result` (the digitized leads) to the further analysis steps here.
    // The leads are not sent back to the client yet; for now the response only
    // confirms that the digitizer finished.
    void result;
    return Response.json({ message: "The ECG digitizer has finished processing the image." });
  } catch (error) {
    if (error instanceof DigitizerNotConfiguredError) {
      return Response.json({ error: error.message }, { status: 501 });
    }
    throw error;
  }
}

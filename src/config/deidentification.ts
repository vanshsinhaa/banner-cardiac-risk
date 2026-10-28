//settings for de-identification step (task 51)

//capture screen talks to OUR OWN NEXT.js route (same website address), and that route talks to the Python backend.
//This avoids CORS problems andthe "https page calling an http server" block that phones enforce.

export const DEID_ENDPOINT = "/api/deidentify";

//how long to wait before giving up (milliseconds). OCR can take several seconds
export const DEID_TIMEOUT_MS = 60_000;

//only backend status we treat as success. Anything else blocks image
export const DEID_SUCCESS_STATUS = "redacted";

//Messages shows to the user when the image is blocked
export const DEID_MESSAGES = {
    failed:
        "We couldn't remove identifying information from this image, so it was not saved or sent. Please try again.",
    timeout: 
        "De-identification took too long, so the image was not saved or sent. Please try again.",
    notConfirmed:
        "We couldn't confirm that identifying information was removed, so the image was not saved or sent. Please retake the photo or try again.",
};
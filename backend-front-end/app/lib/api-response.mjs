export async function readApiResponse(response) {
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(response.status >= 500
      ? "The server could not complete this request. Please try again shortly."
      : "The server returned an unexpected response. Please refresh and try again.");
  }
  if (!response.ok) {
    throw new Error(typeof data?.detail === "string" ? data.detail : "Something went wrong. Try again.");
  }
  return data;
}

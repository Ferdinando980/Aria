// Client for the local PDF<->Word conversion sidecar (see
// ../../../pdf-convert-service/server.js, a separate Node process the user
// runs on their own PC). Aria is a static site with no backend of its own,
// and there's no way to shell out to LibreOffice/Word or watch a local file
// from a browser tab -- this is the bridge. Calling http://localhost from
// an https:// page is allowed by browsers (a secure-context exception for
// localhost), so this works from the deployed Netlify site too, as long as
// the sidecar is running on the same machine the browser is on.
const BASE_URL = 'http://localhost:8765'
const HEALTH_TIMEOUT_MS = 1500

export async function isLocalConvertAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) })
    return res.ok
  } catch {
    return false
  }
}

/** Sends the PDF to the sidecar, which converts it to .docx and opens it in
 * the user's default editor right away -- returns a jobId to poll. */
export async function startWordEdit(pdfBlob: Blob): Promise<string> {
  const res = await fetch(`${BASE_URL}/start-edit`, { method: 'POST', body: pdfBlob })
  if (!res.ok) throw new Error(`start-edit failed: ${await res.text().catch(() => res.statusText)}`)
  const data = (await res.json()) as { jobId: string }
  return data.jobId
}

export type EditJobStatus =
  | { done: false; status: 'editing' | 'converting' }
  | { done: true; ok: true; pdfBlob: Blob }
  | { done: true; ok: false; error: string }

/** One poll of a job started with startWordEdit. The sidecar itself detects
 * when the person has actually saved real changes (comparing file content,
 * not just "something touched it") and reconverts on its own -- this just
 * asks "is it ready yet". */
export async function pollWordEdit(jobId: string): Promise<EditJobStatus> {
  const res = await fetch(`${BASE_URL}/edit-status/${jobId}`)
  if (res.status === 200) {
    return { done: true, ok: true, pdfBlob: await res.blob() }
  }
  if (res.status === 202) {
    const data = (await res.json()) as { status: 'editing' | 'converting' }
    return { done: false, status: data.status }
  }
  const data = await res.json().catch(() => ({ error: res.statusText }))
  return { done: true, ok: false, error: data.error ?? res.statusText }
}

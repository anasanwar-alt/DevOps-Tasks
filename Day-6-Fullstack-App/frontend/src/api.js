// The entire network layer of this app, in one file.
//
// Every URL here is RELATIVE ("/api/tasks", not "http://localhost:3000/api/tasks").
// That is deliberate and it is what makes the container work: the browser sends
// the request back to whatever origin served the page (localhost:8080), nginx
// matches `location /api/` and forwards it to the backend.
//
// Two consequences worth naming:
//   1. No CORS. The browser never makes a cross-origin request.
//   2. No build-time API URL. The same image runs anywhere; nothing about the
//      backend's address is baked into the JavaScript bundle.
const BASE = "/api/tasks";

/** One place where HTTP failures become JS exceptions, so callers just try/catch. */
async function request(url, options) {
  const res = await fetch(url, options);

  if (!res.ok) {
    // The API sends {"error": "..."} on failure; fall back if it sent nothing.
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }

  // 204 No Content (what DELETE returns) has no body to parse.
  return res.status === 204 ? null : res.json();
}

const asJson = (body) => ({
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const listTasks = () => request(BASE);

export const createTask = (title) =>
  request(BASE, { method: "POST", ...asJson({ title }) });

export const toggleTask = (id) => request(`${BASE}/${id}`, { method: "PATCH" });

export const deleteTask = (id) => request(`${BASE}/${id}`, { method: "DELETE" });

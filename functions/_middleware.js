async function sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  if (url.pathname.match(/^\/s=/)) {
    const rewriteUrl = new URL('/index.html', request.url);
    const rewriteRequest = new Request(rewriteUrl, request);
    const response = await fetch(rewriteRequest);
    const contentType = response.headers.get("content-type") || "";

    if (contentType.includes("text/html")) {
      let html = await response.text();
      const password = env.PASSWORD || "";
      let passwordHash = "";
      if (password) {
        passwordHash = await sha256(password);
      }
      html = html.replace('window.__ENV__.PASSWORD = "{{PASSWORD}}";',
        `window.__ENV__.PASSWORD = "${passwordHash}";`);
      return new Response(html, {
        headers: response.headers,
        status: response.status,
        statusText: response.statusText,
      });
    }
    return response;
  }

  const response = await next();
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("text/html")) {
    let html = await response.text();
    const password = env.PASSWORD || "";
    let passwordHash = "";
    if (password) {
      passwordHash = await sha256(password);
    }
    html = html.replace('window.__ENV__.PASSWORD = "{{PASSWORD}}";',
      `window.__ENV__.PASSWORD = "${passwordHash}";`);
    return new Response(html, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    });
  }

  return response;
}

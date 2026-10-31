(function () {
  'use strict';

  // Thin client for the nirahh-tryon proxy contract (api/openapi.json).
  // Every call is a plain POST under {proxyPath}/v1/...; Shopify's own app
  // proxy appends the signed shop/customer identity as query parameters on
  // the way through, so nothing here adds or reads any credential itself.
  // The one generic safe-notice fallback below (for a response with no
  // parseable JSON body, or a network failure) reuses the exact wording
  // PRD.md section 3.6 assigns to protocol/infrastructure failures, rather
  // than inventing new customer-facing text.
  var GENERIC_ERROR = {
    code: 'SERVICE_UNAVAILABLE',
    message: 'Something went wrong. Please try again.',
    retryable: true
  };

  function readEnvelope(response) {
    return response.json().then(
      function (envelope) {
        if (!response.ok || envelope.error) {
          throw toError(envelope.error, response.status);
        }
        return envelope.data;
      },
      function () {
        throw toError(null, response.status);
      }
    );
  }

  function toError(apiError, httpStatus) {
    var source = apiError || GENERIC_ERROR;
    var err = new Error(source.message);
    err.code = source.code;
    err.retryable = !!source.retryable;
    err.retryAfterMs = source.retry_after_ms;
    err.limits = source.limits;
    err.httpStatus = httpStatus;
    return err;
  }

  function postJSON(url, body, signal) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: signal
    }).then(readEnvelope, function (networkError) {
      if (networkError && networkError.name === 'AbortError') throw networkError;
      throw toError(null, 0);
    });
  }

  // Uses XMLHttpRequest, not fetch, because only XHR exposes upload-progress
  // events; PRD.md section 3.1 requires the Validate-upload progress bar to
  // be bound to real bytes moving, never a fabricated percentage.
  function uploadFile(ticket, file, onProgress) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      var form = new FormData();
      Object.keys(ticket.fields || {}).forEach(function (key) {
        form.append(key, ticket.fields[key]);
      });
      form.append('file', file, file.name);

      xhr.upload.addEventListener('progress', function (event) {
        if (onProgress && event.lengthComputable) onProgress(event.loaded, event.total);
      });
      xhr.addEventListener('load', function () {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(toError(null, xhr.status));
      });
      xhr.addEventListener('error', function () { reject(toError(null, 0)); });
      xhr.addEventListener('abort', function () {
        var err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });

      xhr.open(ticket.method || 'POST', ticket.upload_url, true);
      xhr.send(form);
    });
  }

  function client(proxyPath) {
    var base = String(proxyPath || '').replace(/\/$/, '') + '/v1';
    return {
      sessionStart: function (body, signal) { return postJSON(base + '/session/start', body, signal); },
      sessionResume: function (body, signal) { return postJSON(base + '/session/resume', body, signal); },
      sessionActivity: function (body, signal) { return postJSON(base + '/session/activity', body, signal); },
      eligibility: function (body, signal) { return postJSON(base + '/products/eligibility', body, signal); },
      uploadPrepare: function (body, signal) { return postJSON(base + '/uploads/prepare', body, signal); },
      uploadComplete: function (body, signal) { return postJSON(base + '/uploads/complete', body, signal); },
      uploadStatus: function (body, signal) { return postJSON(base + '/uploads/status', body, signal); },
      uploadFile: uploadFile
    };
  }

  window.NirahhTryOnAPI = { client: client };
})();

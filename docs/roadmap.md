# Roadmap

## v0.2

- **`onFailure` redaction hook**: Pipeline-level callback to sanitize `Failure` objects before they leave the pipeline boundary. Allows callers to strip PII, API keys, or other sensitive data from `input`, `output`, and `reason` fields without manual post-processing.

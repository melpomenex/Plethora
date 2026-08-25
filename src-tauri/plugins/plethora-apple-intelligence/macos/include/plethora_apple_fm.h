// Copyright 2026 Plethora
// SPDX-License-Identifier: Apache-2.0

#ifndef PLETHORA_APPLE_FM_H
#define PLETHORA_APPLE_FM_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/// Callback for streaming events: event_type is "text", "complete", or "error".
/// payload_json is UTF-8 JSON owned by the bridge; copy before returning.
typedef void (*plethora_fm_stream_cb)(const char *event_type, const char *payload_json, void *ctx);

/// Returns JSON: {"status","reason?","contextSize?","tokenLimit?"}. Caller frees.
char *plethora_fm_availability(void);

/// Args JSON matches FmGenerateRequest. Returns JSON FmGenerateResponse or error object. Caller frees.
char *plethora_fm_generate(const char *args_json);

/// Same args; invokes cb for partial text events then complete/error. Returns NULL on dispatch ok.
char *plethora_fm_generate_stream(const char *args_json, plethora_fm_stream_cb cb, void *ctx);

/// Args JSON: {"requestId"}. Returns JSON {"ok":true}. Caller frees.
char *plethora_fm_cancel(const char *args_json);

/// Args JSON matches FmGenerateRequest. Returns token count JSON. Caller frees.
char *plethora_fm_count_tokens(const char *args_json);

/// Returns JSON {"ok":true}. Caller frees.
char *plethora_fm_warmup(void);

void plethora_fm_free_string(char *s);

#ifdef __cplusplus
}
#endif

#endif

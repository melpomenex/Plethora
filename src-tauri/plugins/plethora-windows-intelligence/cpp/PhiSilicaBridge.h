#pragma once

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/** AIFeatureReadyState as int, or negative on error. */
int32_t plethora_phi_get_ready_state(void);

/** Generate text into out_buf (UTF-8). Returns 0 on success, negative on error. */
int32_t plethora_phi_generate(
    const char* prompt_utf8,
    uint32_t max_output_tokens,
    char* out_buf,
    uint32_t out_buf_len,
    char* err_buf,
    uint32_t err_buf_len);

/** Cancel is best-effort until streaming is wired. */
int32_t plethora_phi_cancel(const char* request_id_utf8);

/** 1 when C++/WinRT bridge compiled and linked, 0 when stubs. */
int32_t plethora_phi_bridge_available(void);

#ifdef __cplusplus
}
#endif

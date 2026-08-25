#include "PhiSilicaBridge.h"

#include <windows.h>
#include <cstring>
#include <string>

#if defined(PLETHORA_PHI_SILICA_CPP) && defined(_WIN32)

#include <winrt/Windows.Foundation.h>
#include <winrt/Microsoft.Windows.AI.h>
#include <winrt/Microsoft.Windows.AI.Text.h>

using namespace winrt;
using namespace Microsoft::Windows::AI;
using namespace Microsoft::Windows::AI::Text;

static std::string narrow(const winrt::hstring& hs) {
  std::wstring ws(hs.c_str());
  if (ws.empty()) return {};
  int len = WideCharToMultiByte(CP_UTF8, 0, ws.c_str(), static_cast<int>(ws.size()), nullptr, 0, nullptr, nullptr);
  std::string out(len, '\0');
  WideCharToMultiByte(CP_UTF8, 0, ws.c_str(), static_cast<int>(ws.size()), out.data(), len, nullptr, nullptr);
  return out;
}

static void set_err(char* err_buf, uint32_t err_buf_len, const char* msg) {
  if (!err_buf || err_buf_len == 0) return;
  strncpy_s(err_buf, err_buf_len, msg, _TRUNCATE);
}

extern "C" int32_t plethora_phi_bridge_available(void) { return 1; }

extern "C" int32_t plethora_phi_get_ready_state(void) {
  try {
    init_apartment();
    return static_cast<int32_t>(LanguageModel::GetReadyState());
  } catch (...) {
    return -1;
  }
}

extern "C" int32_t plethora_phi_generate(
    const char* prompt_utf8,
    uint32_t max_output_tokens,
    char* out_buf,
    uint32_t out_buf_len,
    char* err_buf,
    uint32_t err_buf_len) {
  if (!prompt_utf8 || !out_buf || out_buf_len == 0) {
    set_err(err_buf, err_buf_len, "invalid_argument");
    return -2;
  }
  try {
    init_apartment();
    auto ready = LanguageModel::GetReadyState();
    if (ready == AIFeatureReadyState::NotReady) {
      LanguageModel::EnsureReadyAsync().get();
    }
    auto model = LanguageModel::CreateAsync().get();
    LanguageModelOptions options;
    if (max_output_tokens > 0) {
      options.MaxTokens(max_output_tokens);
    }
    winrt::hstring prompt = winrt::to_hstring(prompt_utf8);
    auto result = model.GenerateResponseAsync(prompt, options).get();
    auto text = narrow(result.Text());
    if (text.size() >= out_buf_len) {
      set_err(err_buf, err_buf_len, "output_too_large");
      return -3;
    }
    strncpy_s(out_buf, out_buf_len, text.c_str(), _TRUNCATE);
    return 0;
  } catch (const winrt::hresult_error& e) {
    set_err(err_buf, err_buf_len, narrow(e.message()).c_str());
    return static_cast<int32_t>(e.code());
  } catch (...) {
    set_err(err_buf, err_buf_len, "inference_failed");
    return -1;
  }
}

extern "C" int32_t plethora_phi_cancel(const char* request_id_utf8) {
  (void)request_id_utf8;
  return 0;
}

#else

extern "C" int32_t plethora_phi_bridge_available(void) { return 0; }

extern "C" int32_t plethora_phi_get_ready_state(void) { return -1; }

extern "C" int32_t plethora_phi_generate(
    const char* prompt_utf8,
    uint32_t max_output_tokens,
    char* out_buf,
    uint32_t out_buf_len,
    char* err_buf,
    uint32_t err_buf_len) {
  (void)prompt_utf8;
  (void)max_output_tokens;
  (void)out_buf;
  (void)out_buf_len;
  if (err_buf && err_buf_len > 0) {
    strncpy(err_buf, "winrt_bindings_pending", err_buf_len - 1);
    err_buf[err_buf_len - 1] = '\0';
  }
  return -1;
}

extern "C" int32_t plethora_phi_cancel(const char* request_id_utf8) {
  (void)request_id_utf8;
  return 0;
}

#endif

#include "PhiSilicaBridge.h"

#include <windows.h>
#include <cstring>
#include <string>

#if defined(PLETHORA_PHI_SILICA_CPP) && defined(_WIN32)

#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.ApplicationModel.h>
#include <winrt/Microsoft.Windows.AI.h>
#include <winrt/Microsoft.Windows.AI.Text.h>
#include <winrt/Windows.Storage.Streams.h>
#include <winrt/Windows.Graphics.Imaging.h>
#include <winrt/Microsoft.Graphics.Imaging.h>
#include <winrt/Microsoft.Windows.AI.Imaging.h>

#include <algorithm>
#include <sstream>

using namespace winrt;
using namespace Microsoft::Windows::AI;
using namespace Microsoft::Windows::AI::Text;
using namespace Microsoft::Windows::AI::Imaging;
using namespace winrt::Windows::Storage::Streams;
using namespace winrt::Windows::Graphics::Imaging;
using namespace Microsoft::Graphics::Imaging;

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

extern "C" int32_t plethora_phi_try_unlock_laf(
    const char* feature_id_utf8,
    const char* token_utf8,
    const char* attestation_utf8) {
  if (!feature_id_utf8 || !token_utf8 || !attestation_utf8) return -2;
  try {
    init_apartment();
    auto status = Windows::ApplicationModel::LimitedAccessFeatures::TryUnlockFeature(
        winrt::to_hstring(feature_id_utf8),
        winrt::to_hstring(token_utf8),
        winrt::to_hstring(attestation_utf8));
    return static_cast<int32_t>(status);
  } catch (...) {
    return -1;
  }
}

extern "C" int32_t plethora_ocr_get_ready_state(void) {
  try {
    init_apartment();
    return static_cast<int32_t>(TextRecognizer::GetReadyState());
  } catch (...) {
    return -1;
  }
}

static std::string json_escape(const std::string& input) {
  std::string out;
  for (char ch : input) {
    switch (ch) {
      case '\\': out += "\\\\"; break;
      case '"': out += "\\\""; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (static_cast<unsigned char>(ch) < 0x20) {
          out += ' ';
        } else {
          out += ch;
        }
        break;
    }
  }
  return out;
}

extern "C" int32_t plethora_ocr_recognize_image(
    const uint8_t* image_data,
    uint32_t image_len,
    char* out_buf,
    uint32_t out_buf_len,
    char* err_buf,
    uint32_t err_buf_len) {
  if (!image_data || image_len == 0 || !out_buf || out_buf_len == 0) {
    set_err(err_buf, err_buf_len, "invalid_argument");
    return -2;
  }
  try {
    init_apartment();
    auto ready = TextRecognizer::GetReadyState();
    if (ready == AIFeatureReadyState::NotReady) {
      TextRecognizer::EnsureReadyAsync().get();
    }

    InMemoryRandomAccessStream stream;
    DataWriter writer(stream);
    writer.WriteBytes(array_view<const uint8_t>(image_data, image_len));
    writer.StoreAsync().get();
    writer.FlushAsync().get();
    writer.DetachStream();

    BitmapDecoder decoder = BitmapDecoder::CreateAsync(stream).get();
    SoftwareBitmap bitmap = decoder.GetSoftwareBitmapAsync().get();
    ImageBuffer image_buffer = ImageBuffer::CreateForSoftwareBitmap(bitmap);

    auto recognizer = TextRecognizer::CreateAsync().get();
    RecognizedText recognized = recognizer.RecognizeTextFromImageAsync(image_buffer).get();

    std::ostringstream json;
    std::ostringstream text_builder;
    double confidence_sum = 0.0;
    size_t confidence_count = 0;
    json << "{\"lines\":[";
    bool first_line = true;
    for (auto const& line : recognized.Lines()) {
      std::string line_text = narrow(line.Text());
      if (!line_text.empty()) {
        if (!text_builder.str().empty()) {
          text_builder << '\n';
        }
        text_builder << line_text;
      }
      double line_confidence = 85.0;
      double left = 0.0;
      double top = 0.0;
      double right = 0.0;
      double bottom = 0.0;
      try {
        auto box = line.BoundingBox();
        auto tl = box.TopLeft();
        auto tr = box.TopRight();
        auto br = box.BottomRight();
        auto bl = box.BottomLeft();
        left = std::min({tl.X, tr.X, br.X, bl.X});
        top = std::min({tl.Y, tr.Y, br.Y, bl.Y});
        right = std::max({tl.X, tr.X, br.X, bl.X});
        bottom = std::max({tl.Y, tr.Y, br.Y, bl.Y});
      } catch (...) {
      }
      confidence_sum += line_confidence;
      confidence_count += 1;
      if (!first_line) {
        json << ',';
      }
      first_line = false;
      json << "{\"text\":\"" << json_escape(line_text) << "\",\"confidence\":" << line_confidence
           << ",\"left\":" << left << ",\"top\":" << top << ",\"right\":" << right
           << ",\"bottom\":" << bottom << "}";
    }
    json << "],\"text\":\"" << json_escape(text_builder.str()) << "\",\"confidence\":";
    if (confidence_count > 0) {
      json << (confidence_sum / static_cast<double>(confidence_count));
    } else {
      json << 0.0;
    }
    json << "}";

    const std::string payload = json.str();
    if (payload.size() >= out_buf_len) {
      set_err(err_buf, err_buf_len, "output_too_large");
      return -3;
    }
    strncpy_s(out_buf, out_buf_len, payload.c_str(), _TRUNCATE);
    return 0;
  } catch (const winrt::hresult_error& e) {
    set_err(err_buf, err_buf_len, narrow(e.message()).c_str());
    return static_cast<int32_t>(e.code());
  } catch (...) {
    set_err(err_buf, err_buf_len, "ocr_failed");
    return -1;
  }
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

extern "C" int32_t plethora_phi_try_unlock_laf(
    const char* feature_id_utf8,
    const char* token_utf8,
    const char* attestation_utf8) {
  (void)feature_id_utf8;
  (void)token_utf8;
  (void)attestation_utf8;
  return -1;
}

extern "C" int32_t plethora_ocr_get_ready_state(void) { return -1; }

extern "C" int32_t plethora_ocr_recognize_image(
    const uint8_t* image_data,
    uint32_t image_len,
    char* out_buf,
    uint32_t out_buf_len,
    char* err_buf,
    uint32_t err_buf_len) {
  (void)image_data;
  (void)image_len;
  (void)out_buf;
  (void)out_buf_len;
  if (err_buf && err_buf_len > 0) {
    strncpy(err_buf, "winrt_bindings_pending", err_buf_len - 1);
    err_buf[err_buf_len - 1] = '\0';
  }
  return -1;
}

#endif

// Isolated Phase 1 probe. Not linked into or selected by Plethora.
// Uses llama.cpp/libmtmd at ac8e1694d837b11ed0aab944a6a2eee34b9c4d80.
#include "chat.h"
#include "llama.h"
#include "ggml-backend.h"
#ifndef LFM3_SPIKE_CUDA
#define LFM3_SPIKE_CUDA 0
#endif
#include "mtmd.h"
#include "mtmd-helper.h"
#include <chrono>
#include <csignal>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

static volatile std::sig_atomic_t cancelled = 0;
static std::string probe_case = "voices";
static void cancel(int) { cancelled = 1; }
static bool loading(float, void *) {
    if (probe_case == "load-cancel") cancelled = 1;
    return !cancelled;
}
static bool aborting(void *) { return cancelled; }
using Clock = std::chrono::steady_clock;
static double elapsed(Clock::time_point t) {
    return std::chrono::duration<double>(Clock::now() - t).count();
}
static void check(bool ok, const char * code) {
    if (!ok) throw std::runtime_error(code);
}
static void validate_text(const std::string & text) {
    check(!text.empty() && text.size() <= 700, "input_limit");
    check(text.find("<|") == std::string::npos, "control_token_input");
}

static void synthesize(llama_context * ctx, mtmd_context * mm,
                       const common_chat_templates * templates,
                       const std::string & text, const char * voice, const char * locale,
                       const std::filesystem::path & output, int cap) {
    validate_text(text);
    const auto started = Clock::now();
    // Reset recurrent/KV state as well as fresh depthformer/codec/sampling state.
    llama_memory_clear(llama_get_memory(ctx), true);
    mtmd_helper::gen_audio gen;
    gen.init(ctx, mm);
    check(gen.valid(), "generator_init");
    const std::string prompt = common_chat_get_tts_prompt(templates, text, locale, voice);
    check(!prompt.empty(), "missing_tts_template");
    std::vector<llama_token> tokens(prompt.size() + 16);
    int count = llama_tokenize(llama_model_get_vocab(llama_get_model(ctx)), prompt.data(),
                              prompt.size(), tokens.data(), tokens.size(), false, true);
    check(count > 0 && count <= 512, "prompt_token_limit");
    auto input = mtmd_helper_gen_audio_inp_default();
    input.prompt = prompt.c_str(); input.prompt_len = prompt.size();
    input.lang = locale; input.voice = voice; input.seed = 42;
    // Complete output exercises get_output's final codec-tail flush.
    input.stream = false;
    check(gen.set_input(&input) == 0, "set_input");
    for (;;) {
        check(!cancelled, "cancelled_prompt");
        check(elapsed(started) < 60, "timeout_prompt");
        int result = gen.step_prompt(128);
        check(result >= 0, "prompt_decode");
        if (result == 0) break;
    }
    bool eos = false;
    int frames = 0;
    const float * hidden = llama_get_embeddings_ith(ctx, -1);
    check(hidden != nullptr, "missing_embeddings");
    while (!eos && frames < cap) {
        check(!cancelled, "cancelled_frame");
        check(elapsed(started) < 60, "timeout_frame");
        check(!gen.next_is_text(), "unexpected_text_mode");
        const float * next = nullptr;
        check(gen.step_gen(LLAMA_TOKEN_NULL, hidden, &next, &eos) == 0, "frame_decode");
        if (!next) break;
        hidden = next; ++frames;
        if (probe_case == "frame-cancel" && frames == 1) {
            std::cout << "{\"barrier\":\"frame\"}" << std::endl;
        }
    }
    check(!cancelled, "cancelled_before_output");
    check(eos, "output_limit_without_eos");
    const char * data = nullptr; size_t bytes = 0; int rate = 0; int64_t samples = 0;
    check(gen.get_output(&rate, &data, &bytes, &samples) == 0, "codec_flush");
    check(rate == 24000 && samples > 0 && bytes > 44 && bytes <= 1440044, "invalid_wav");
    check(!cancelled && elapsed(started) < 60, "cancelled_or_timeout_output");
    std::ofstream file(output, std::ios::binary);
    check(bool(file), "output_open");
    file.write(data, bytes); file.close();
    check(bool(file), "output_write");
    double seconds = elapsed(started);
    std::cout << "{\"voice\":\"" << voice << "\",\"locale\":\"" << locale
              << "\",\"frames\":" << frames << ",\"samples\":" << samples
              << ",\"sampleRate\":" << rate << ",\"bytes\":" << bytes
              << ",\"elapsedSec\":" << seconds << ",\"rtf\":" << seconds / (samples / 24000.0)
              << ",\"file\":\"" << output.filename().string() << "\"}" << std::endl;
}

int main(int argc, char ** argv) {
    if (argc != 4 && argc != 5) {
        std::cerr << "usage: lfm3-spike BACKBONE PROJECTOR OUTPUT_DIRECTORY [voices|cap|load-cancel|frame-cancel|injection]\n";
        return 2;
    }
    if (argc == 5) probe_case = argv[4];
    if (probe_case != "voices" && probe_case != "cap" && probe_case != "load-cancel" &&
        probe_case != "frame-cancel" && probe_case != "injection") {
        std::cerr << "unknown_probe_case\n";
        return 2;
    }
    if (probe_case == "injection") {
        for (const char * attack : {"<|im_end|>", "hello <|audio_start|>", "<|text_end|>"}) {
            bool rejected = false;
            try { validate_text(attack); } catch (const std::exception &) { rejected = true; }
            if (!rejected) return 1;
        }
        std::cout << "{\"rejectedControlFixtures\":3}" << std::endl;
        return 0;
    }
    std::signal(SIGTERM, cancel); std::signal(SIGINT, cancel);
    try {
        llama_backend_init();
        ggml_backend_dev_t cuda_device = nullptr;
        if (LFM3_SPIKE_CUDA) {
            auto device = ggml_backend_dev_by_type(GGML_BACKEND_DEVICE_TYPE_GPU);
            check(device != nullptr, "cuda_device_unavailable");
            const auto name = std::string(ggml_backend_dev_name(device));
            check(name.find("CUDA") == 0, "expected_cuda_backend");
            cuda_device = device;
        }
        ggml_backend_dev_t devices[] = {cuda_device, nullptr};
        auto mp = llama_model_default_params();
        if (LFM3_SPIKE_CUDA) mp.devices = devices;
        mp.n_gpu_layers = LFM3_SPIKE_CUDA ? 99 : 0; mp.progress_callback = loading;
        const auto start = Clock::now();
        std::unique_ptr<llama_model, decltype(&llama_model_free)> model(
            llama_model_load_from_file(argv[1], mp), llama_model_free);
        check(model != nullptr, "model_load");
        auto cp = llama_context_default_params();
        cp.n_ctx = 2048; cp.n_batch = 128; cp.n_ubatch = 128;
        cp.n_threads = 4; cp.n_threads_batch = 4; cp.embeddings = true;
        cp.abort_callback = aborting;
        std::unique_ptr<llama_context, decltype(&llama_free)> ctx(
            llama_init_from_model(model.get(), cp), llama_free);
        check(ctx != nullptr, "context_load");
        auto mmp = mtmd_context_params_default();
        mmp.use_gpu = LFM3_SPIKE_CUDA; mmp.device = cuda_device; mmp.n_threads = 4;
        mtmd::context_ptr mm(mtmd_init_from_file(argv[2], model.get(), mmp));
        check(mm != nullptr, "projector_load");
        auto info = mtmd_gen_audio_get_info(mm.get());
        check(info.type == MTMD_GEN_AUDIO_TYPE_LFM3A && info.sample_rate == 24000, "wrong_pipeline");
        auto templates = common_chat_templates_init(model.get(), "");
        std::cout << "{\"loaded\":true,\"backend\":\"" << (LFM3_SPIKE_CUDA ? "cuda" : "cpu") << "\",\"loadSec\":" << elapsed(start) << "}" << std::endl;
        std::filesystem::create_directories(argv[3]);
        if (probe_case == "cap" || probe_case == "frame-cancel") {
            synthesize(ctx.get(), mm.get(), templates.get(),
                       "The little boat crossed the quiet lake before sunset.", "female", "en",
                       std::filesystem::path(argv[3]) / "must-not-publish.wav", probe_case == "cap" ? 1 : 375);
            return 1; // A negative probe must never succeed.
        }
        for (const char * voice : {"female", "male"}) {
            for (const char * locale : {"en", "en-gb"}) {
                const auto file = std::filesystem::path(argv[3]) / (std::string(voice) + "-" + locale + ".wav");
                synthesize(ctx.get(), mm.get(), templates.get(),
                           "The little boat crossed the quiet lake before sunset.", voice, locale, file, 375);
            }
        }
        // Identical fixture after intervening voices/locales detects state bleed.
        synthesize(ctx.get(), mm.get(), templates.get(),
                   "The little boat crossed the quiet lake before sunset.", "female", "en",
                   std::filesystem::path(argv[3]) / "female-en-repeat.wav", 375);
        std::cout << "{\"complete\":true}" << std::endl;
        return 0;
    } catch (const std::exception & error) {
        std::cerr << "probe_failed: " << error.what() << '\n';
        return cancelled ? 130 : 1;
    }
}

// Portable local TTS host. No network, downloads or playback ownership.
#include "chat.h"
#include "llama.h"
#include "ggml-backend.h"
#include "mtmd.h"
#include "mtmd-helper.h"
#include <nlohmann/json.hpp>
#include <algorithm>
#include <array>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>
using json = nlohmann::json;
using Clock = std::chrono::steady_clock;
static constexpr const char * runtime_commit = "ac8e1694d837b11ed0aab944a6a2eee34b9c4d80";
static double elapsed(Clock::time_point t) { return std::chrono::duration<double>(Clock::now() - t).count(); }
static void check(bool ok, const char * code) { if (!ok) throw std::runtime_error(code); }
static void validate_text(const std::string & text) {
    const auto chars = std::count_if(text.begin(), text.end(), [](unsigned char c) { return (c & 0xc0) != 0x80; });
    check(chars > 0 && chars <= 700, "input_limit");
    check(text.find("<|") == std::string::npos, "control_token_input");
}
static bool valid_token(const std::string & s) {
    return !s.empty() && s.size() <= 64 && std::all_of(s.begin(), s.end(), [](unsigned char c) {
        return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-';
    });
}
static json synthesize(llama_context * ctx, mtmd_context * mm,
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
        check(elapsed(started) < 60, "timeout_frame");
        check(!gen.next_is_text(), "unexpected_text_mode");
        const float * next = nullptr;
        check(gen.step_gen(LLAMA_TOKEN_NULL, hidden, &next, &eos) == 0, "frame_decode");
        if (!next) break;
        hidden = next; ++frames;
    }
    check(eos, "output_limit_without_eos");
    const char * data = nullptr; size_t bytes = 0; int rate = 0; int64_t samples = 0;
    check(gen.get_output(&rate, &data, &bytes, &samples) == 0, "codec_flush");
    check(rate == 24000 && samples > 0 && bytes > 44 && bytes <= 1440044, "invalid_wav");
    check(elapsed(started) < 60, "timeout_output");
    std::ofstream file(output, std::ios::binary);
    check(bool(file), "output_open");
    file.write(data, bytes); file.close();
    check(bool(file), "output_write");
    double seconds = elapsed(started);
    return {{"sampleRate", rate}, {"durationSec", samples / 24000.0}, {"byteLength", bytes}, {"elapsedSec", seconds}};
}

static json runtime_info() {
    json backends = json::array();
    for (size_t i = 0; i < ggml_backend_dev_count(); ++i) {
        auto dev = ggml_backend_dev_get(i);
        backends.push_back({{"name", ggml_backend_dev_name(dev)}, {"gpu", ggml_backend_dev_type(dev) == GGML_BACKEND_DEVICE_TYPE_GPU}});
    }
    return {{"protocol", 1}, {"runtimeCommit", runtime_commit}, {"backends", backends}};
}

int main(int argc, char ** argv) {
    try {
        // Optional GPU plugins may fail to load when their driver is absent;
        // the CPU backend remains usable. Only app-selected runtime folders load.
        if (argc == 3 && std::string(argv[1]) == "--probe") ggml_backend_load_all_from_path(argv[2]);
        if (argc == 5) ggml_backend_load_all_from_path(argv[4]);
        llama_backend_init();
        if ((argc == 2 || argc == 3) && std::string(argv[1]) == "--probe") {
            std::cout << runtime_info().dump() << std::endl;
            return 0;
        }
        check(argc == 4 || argc == 5, "invalid_arguments");
        const auto output_root = std::filesystem::canonical(std::filesystem::u8path(argv[3]));
        auto device = ggml_backend_dev_by_type(GGML_BACKEND_DEVICE_TYPE_GPU);
        ggml_backend_dev_t devices[] = {device, nullptr};
        auto mp = llama_model_default_params();
        mp.n_gpu_layers = device ? 99 : 0;
        if (device) mp.devices = devices;
        std::unique_ptr<llama_model, decltype(&llama_model_free)> model(llama_model_load_from_file(argv[1], mp), llama_model_free);
        check(model != nullptr, "model_load");
        auto cp = llama_context_default_params();
        cp.n_ctx = 2048; cp.n_batch = 128; cp.n_ubatch = 128;
        cp.n_threads = 4; cp.n_threads_batch = 4; cp.embeddings = true;
        std::unique_ptr<llama_context, decltype(&llama_free)> ctx(llama_init_from_model(model.get(), cp), llama_free);
        check(ctx != nullptr, "context_load");
        auto mmp = mtmd_context_params_default();
        mmp.use_gpu = device != nullptr; mmp.device = device; mmp.n_threads = 4;
        mtmd::context_ptr mm(mtmd_init_from_file(argv[2], model.get(), mmp));
        check(mm != nullptr, "projector_load");
        const auto info = mtmd_gen_audio_get_info(mm.get());
        check(info.type == MTMD_GEN_AUDIO_TYPE_LFM3A && info.sample_rate == 24000, "wrong_pipeline");
        auto templates = common_chat_templates_init(model.get(), "");
        auto ready = runtime_info();
        ready["ready"] = true; ready["backend"] = device ? ggml_backend_dev_name(device) : "CPU";
        std::cout << ready.dump() << std::endl;
        std::array<char, 65537> frame{};
        while (std::cin.getline(frame.data(), frame.size())) {
            std::string id;
            try {
                const auto request = json::parse(frame.data());
                id = request.at("id").get<std::string>();
                check(valid_token(id), "invalid_request_id");
                const auto text = request.at("text").get<std::string>();
                const auto voice = request.at("voice").get<std::string>();
                const auto language = request.at("language").get<std::string>();
                check(voice == "female" || voice == "male", "invalid_voice");
                const std::vector<std::string> locales = {"ar","da","de","el","en","en-gb","es","fi","fr","he","it","ja","ko","nl","pl","pt","sv","tr","zh"};
                check(std::find(locales.begin(), locales.end(), language) != locales.end(), "invalid_language");
                const auto output = output_root / (id + ".wav");
                check(!std::filesystem::exists(std::filesystem::symlink_status(output)), "output_exists");
                auto result = synthesize(ctx.get(), mm.get(), templates.get(), text, voice.c_str(), language.c_str(), output, 375);
                result["id"] = id; result["ok"] = true; result["backend"] = ready["backend"];
                std::cout << result.dump() << std::endl;
            } catch (const std::exception &) {
                // The parent maps a bounded error code; never echo document text or parser input.
                std::cout << json({{"id", valid_token(id) ? id : ""}, {"ok", false}, {"error", "synthesis_failed"}}).dump() << std::endl;
            }
        }
        return std::cin.eof() ? 0 : 2;
    } catch (const std::exception &) {
        std::cout << json({{"ok", false}, {"error", "runtime_initialization_failed"}}).dump() << std::endl;
        return 1;
    }
}

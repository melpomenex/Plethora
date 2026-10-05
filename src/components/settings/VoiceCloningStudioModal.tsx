/**
 * VoiceCloningStudioModal — Record or upload audio samples, normalize, extract speaker latents,
 * and save custom local voice profiles.
 */

import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../../lib/tauri";
import { Microphone, Upload, Play, Stop, Check, X, CircleNotch, SpeakerHigh } from "@phosphor-icons/react";
import { cloneOpenAIVoice } from "../../api/tts/providers/openai-compatible";

interface VoiceCloningStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  onVoiceCreated?: (voiceId: string) => void;
  localDaemonUrl?: string;
}

export function VoiceCloningStudioModal({
  isOpen,
  onClose,
  onVoiceCreated,
  localDaemonUrl = "http://127.0.0.1:42929/v1",
}: VoiceCloningStudioModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#6366f1");
  const [speed, setSpeed] = useState(1.0);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioBase64, setAudioBase64] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (audioContextRef.current) void audioContextRef.current.close();
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  if (!isOpen) return null;

  const startRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      // Audio level visualizer
      const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      audioContextRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateLevel = () => {
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((acc, val) => acc + val, 0) / dataArray.length;
        setAudioLevel(Math.min(100, Math.round((avg / 128) * 100)));
        animFrameRef.current = requestAnimationFrame(updateLevel);
      };
      updateLevel();

      mediaRecorder.ondataavailable = (evt) => {
        if (evt.data.size > 0) {
          audioChunksRef.current.push(evt.data);
        }
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        setAudioLevel(0);

        const blob = new Blob(audioChunksRef.current, { type: "audio/wav" });
        setAudioBlob(blob);
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);

        // Convert to base64
        const reader = new FileReader();
        reader.onloadend = () => {
          const res = reader.result as string;
          const base64Data = res.split(",")[1] || res;
          setAudioBase64(base64Data);
        };
        reader.readAsDataURL(blob);
      };

      mediaRecorder.start();
      setRecording(true);
      setRecordSeconds(0);
      timerRef.current = window.setInterval(() => {
        setRecordSeconds((s) => {
          if (s >= 15) {
            stopRecording();
            return 15;
          }
          return s + 1;
        });
      }, 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Microphone access denied");
    }
  };

  const stopRecording = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setAudioBlob(file);
    const url = URL.createObjectURL(file);
    setAudioUrl(url);

    const reader = new FileReader();
    reader.onloadend = () => {
      const res = reader.result as string;
      const base64Data = res.split(",")[1] || res;
      setAudioBase64(base64Data);
    };
    reader.readAsDataURL(file);
  };

  const handleCloneAndSave = async () => {
    if (!name.trim()) {
      setError("Please provide a voice name.");
      return;
    }
    if (!audioBase64) {
      setError("Please record or upload an audio sample first.");
      return;
    }

    setProcessing(true);
    setError(null);

    try {
      // Register with standardized local daemon endpoint
      const result = await cloneOpenAIVoice(localDaemonUrl, undefined, name.trim(), audioBase64, description.trim());
      const voiceId = result.id;

      // Also persist to SQLite voice profile table if in Tauri
      if (isTauri()) {
        await invoke("chatterbox_create_voice_profile", {
          profile: {
            id: voiceId,
            name: name.trim(),
            description: description.trim() || null,
            avatarColor: color,
            playbackSpeed: speed,
            preferredContentTypes: [],
            embeddingPath: result.latentPath || `${voiceId}.safetensors`,
            isDefault: false,
            createdAt: Math.floor(Date.now() / 1000),
            updatedAt: Math.floor(Date.now() / 1000),
          },
        });
      }

      onVoiceCreated?.(voiceId);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <div className="flex items-center justify-between pb-4 border-b border-border">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Voice Cloning Studio</h3>
            <p className="text-xs text-muted-foreground">Clone any voice locally using a 5–15 second audio sample.</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-muted-foreground hover:bg-muted">
            <X size={20} />
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded-lg bg-destructive/10 p-3 text-xs text-destructive">
            {error}
          </div>
        )}

        <div className="mt-4 space-y-4">
          {/* Voice Details */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Voice Name *</label>
              <input
                type="text"
                placeholder="e.g. Rachel Academic"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Color Tag</label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-8 w-12 cursor-pointer rounded border border-border bg-background p-0.5"
                />
                <span className="text-xs font-mono text-muted-foreground">{color}</span>
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Description</label>
            <input
              type="text"
              placeholder="e.g. Natural cadence for philosophy reading"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
            />
          </div>

          {/* Audio Ingestion Controls */}
          <div className="rounded-xl border border-border/80 bg-background/60 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">Reference Sample (5–15s)</span>
              {audioBlob && (
                <span className="text-xs text-emerald-500 flex items-center gap-1">
                  <Check size={14} /> Ready ({recordSeconds > 0 ? `${recordSeconds}s` : "File"})
                </span>
              )}
            </div>

            <div className="flex items-center gap-3">
              {recording ? (
                <button
                  onClick={stopRecording}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-destructive px-3 py-2 text-xs font-medium text-destructive-foreground hover:bg-destructive/90"
                >
                  <Stop size={16} /> Stop Recording ({recordSeconds}s)
                </button>
              ) : (
                <button
                  onClick={startRecording}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                >
                  <Microphone size={16} /> Record Mic (WebRTC)
                </button>
              )}

              <label className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-medium cursor-pointer hover:bg-muted">
                <Upload size={16} /> Import Audio File
                <input
                  type="file"
                  accept="audio/wav,audio/mp3,audio/m4a,audio/flac"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>

            {/* Level meter when recording */}
            {recording && (
              <div className="space-y-1">
                <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-1.5 bg-emerald-500 transition-all duration-75"
                    style={{ width: `${audioLevel}%` }}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground text-center">Speak clearly at normal reading volume</p>
              </div>
            )}

            {/* Playback preview if sample exists */}
            {audioUrl && !recording && (
              <div className="flex items-center gap-2 pt-1">
                <audio src={audioUrl} controls className="h-8 w-full rounded" />
              </div>
            )}
          </div>
        </div>

        {/* Modal Actions */}
        <div className="mt-6 flex items-center justify-end gap-3 border-t border-border pt-4">
          <button
            onClick={onClose}
            disabled={processing}
            className="rounded-lg border border-border px-4 py-2 text-xs font-medium hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={handleCloneAndSave}
            disabled={processing || !audioBase64 || !name.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {processing && <CircleNotch size={14} className="animate-spin" />}
            {processing ? "Extracting Speaker Latent..." : "Save Voice Profile"}
          </button>
        </div>
      </div>
    </div>
  );
}

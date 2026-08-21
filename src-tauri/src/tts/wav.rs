//! Minimal mono 16-bit PCM WAV encoding for the desktop TTS engine.
//!
//! Raw PCM from the sherpa callback/`GeneratedAudio` is wrapped into a WAV
//! container only at the desktop IPC boundary (base64 data URL, same shape as
//! Pocket TTS returns). No MP3/Opus hops (design D8).

/// Encode mono f32 samples ([-1, 1]) as a 16-bit PCM WAV file.
pub fn encode_wav_mono_i16(samples: &[f32], sample_rate: u32) -> Vec<u8> {
    let data_len = samples.len() * 2;
    let mut out = Vec::with_capacity(44 + data_len);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&((36 + data_len) as u32).to_le_bytes());
    out.extend_from_slice(b"WAVE");
    // fmt chunk (PCM).
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&1u16.to_le_bytes()); // mono
    out.extend_from_slice(&sample_rate.to_le_bytes());
    out.extend_from_slice(&(sample_rate * 2).to_le_bytes()); // byte rate
    out.extend_from_slice(&2u16.to_le_bytes()); // block align
    out.extend_from_slice(&16u16.to_le_bytes()); // bits per sample
    out.extend_from_slice(b"data");
    out.extend_from_slice(&(data_len as u32).to_le_bytes());
    for s in samples {
        let clamped = s.clamp(-1.0, 1.0);
        let v = (clamped * 32767.0).round() as i16;
        out.extend_from_slice(&v.to_le_bytes());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wav_header_and_payload_are_wellformed() {
        let samples = [0.0f32, 0.5, -0.5, 1.0, -1.0, 2.0 /* clamped */];
        let wav = encode_wav_mono_i16(&samples, 44100);
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        assert_eq!(&wav[12..16], b"fmt ");
        assert_eq!(&wav[36..40], b"data");
        let data_len = u32::from_le_bytes([wav[40], wav[41], wav[42], wav[43]]) as usize;
        assert_eq!(data_len, samples.len() * 2);
        assert_eq!(wav.len(), 44 + data_len);
        let sr = u32::from_le_bytes([wav[24], wav[25], wav[26], wav[27]]);
        assert_eq!(sr, 44100);
        // 0.5 → 16384 (approx), clamped 2.0 → 32767.
        let first = i16::from_le_bytes([wav[44], wav[45]]);
        assert_eq!(first, 0);
        let half = i16::from_le_bytes([wav[46], wav[47]]);
        assert_eq!(half, 16384);
        let clamped = i16::from_le_bytes([wav[44 + 10], wav[45 + 10]]);
        assert_eq!(clamped, 32767);
    }
}

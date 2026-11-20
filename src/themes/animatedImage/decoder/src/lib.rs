use gif::{ColorOutput, DecodeOptions, Decoder, DisposalMethod, MemoryLimit, Repeat};
use std::{cell::RefCell, io::Cursor, num::NonZeroU64, slice};

const MAX_INPUT_BYTES: usize = 16 * 1024 * 1024;
const MAX_LOGICAL_PIXELS: usize = 2_073_600;
const MAX_FRAMES: usize = 450;
const MAX_PATCH_PIXELS: usize = 150_000_000;
const FRAME_HEADER_BYTES: usize = 20;

struct DecoderState {
    decoder: Decoder<Cursor<Vec<u8>>>,
    global_palette: Option<Vec<u8>>,
    width: usize,
    height: usize,
    frame_count: usize,
    patch_pixels: usize,
}

thread_local! {
    static DECODERS: RefCell<Vec<Option<DecoderState>>> = const { RefCell::new(Vec::new()) };
}

#[no_mangle]
pub extern "C" fn alloc(capacity: usize) -> *mut u8 {
    let mut bytes = Vec::<u8>::with_capacity(capacity);
    let pointer = bytes.as_mut_ptr();
    std::mem::forget(bytes);
    pointer
}

#[no_mangle]
pub unsafe extern "C" fn dealloc(pointer: *mut u8, capacity: usize) {
    if !pointer.is_null() && capacity > 0 {
        drop(Vec::from_raw_parts(pointer, 0, capacity));
    }
}

/// Creates a strict indexed decoder and returns an opaque positive handle.
/// Error codes: -1 input size, -2 signature, -3 decode header, -4 dimensions.
#[no_mangle]
pub unsafe extern "C" fn decoder_new(input_pointer: *const u8, input_length: usize) -> i32 {
    if input_pointer.is_null() || input_length == 0 || input_length > MAX_INPUT_BYTES {
        return -1;
    }
    let input = slice::from_raw_parts(input_pointer, input_length);
    if input.get(..6) != Some(b"GIF87a") && input.get(..6) != Some(b"GIF89a") {
        return -2;
    }

    let mut options = DecodeOptions::new();
    options.set_color_output(ColorOutput::Indexed);
    options.set_memory_limit(MemoryLimit::Bytes(
        NonZeroU64::new(MAX_LOGICAL_PIXELS as u64).expect("positive pixel limit"),
    ));
    options.check_frame_consistency(true);
    // Some encoders omit the LZW end code after writing a complete frame.
    // Structural preflight still requires terminated sub-blocks and a trailer;
    // the decoder rejects invalid codes and requires a frame-sized output.
    options.check_lzw_end_code(false);
    let owned_input = input.to_vec();
    let decoder = match options.read_info(Cursor::new(owned_input)) {
        Ok(decoder) => decoder,
        Err(_) => return -3,
    };
    let width = usize::from(decoder.width());
    let height = usize::from(decoder.height());
    let global_palette = decoder.global_palette().map(|palette| palette.to_vec());
    if width == 0
        || height == 0
        || width > 2_048
        || height > 2_048
        || width * height > MAX_LOGICAL_PIXELS
    {
        return -4;
    }

    DECODERS.with(|decoders| {
        let mut decoders = decoders.borrow_mut();
        if let Some((index, slot)) = decoders
            .iter_mut()
            .enumerate()
            .find(|(_, slot)| slot.is_none())
        {
            *slot = Some(DecoderState {
                decoder,
                global_palette,
                width,
                height,
                frame_count: 0,
                patch_pixels: 0,
            });
            (index + 1) as i32
        } else {
            decoders.push(Some(DecoderState {
                decoder,
                global_palette,
                width,
                height,
                frame_count: 0,
                patch_pixels: 0,
            }));
            decoders.len() as i32
        }
    })
}

/// Writes [width, height, repeat kind, repeat count] to a caller-owned i32 array.
/// Repeat kind is 0 for one play, 1 for infinite, and 2 for a finite repeat count.
#[no_mangle]
pub unsafe extern "C" fn decoder_info(
    handle: i32,
    output_pointer: *mut i32,
    output_length: usize,
) -> i32 {
    if output_pointer.is_null() || output_length < 4 || handle <= 0 {
        return -1;
    }
    DECODERS.with(|decoders| {
        let decoders = decoders.borrow();
        let Some(Some(state)) = decoders.get((handle - 1) as usize) else {
            return -2;
        };
        let (repeat_kind, repeat_count) = match state.decoder.repeat() {
            Repeat::Infinite => (1, 0),
            Repeat::Finite(count) if count > 0 => (2, i32::from(count)),
            Repeat::Finite(_) => (0, 0),
        };
        let output = slice::from_raw_parts_mut(output_pointer, output_length);
        output[0] = state.width as i32;
        output[1] = state.height as i32;
        output[2] = repeat_kind;
        output[3] = repeat_count;
        0
    })
}

/// Decodes and writes one frame. Result is byte length, zero at end, or a negative error.
/// Frame payload: fixed 20-byte little-endian header, RGB palette, indexed patch pixels.
/// Header fields: left:u16, top:u16, width:u16, height:u16, delay:u16,
/// disposal:u8, transparent_index:u8, transparent_present:u8, reserved:u8,
/// palette_bytes:u16, patch_bytes:u32.
#[no_mangle]
pub unsafe extern "C" fn decoder_next(
    handle: i32,
    output_pointer: *mut u8,
    output_capacity: usize,
) -> i32 {
    if output_pointer.is_null() || handle <= 0 {
        return -1;
    }
    DECODERS.with(|decoders| {
        let mut decoders = decoders.borrow_mut();
        let Some(Some(state)) = decoders.get_mut((handle - 1) as usize) else {
            return -2;
        };
        let frame = match state.decoder.read_next_frame() {
            Ok(Some(frame)) => frame,
            Ok(None) => return 0,
            Err(_) => return -3,
        };

        let left_u16 = frame.left;
        let top_u16 = frame.top;
        let width_u16 = frame.width;
        let height_u16 = frame.height;
        let left = usize::from(left_u16);
        let top = usize::from(top_u16);
        let width = usize::from(width_u16);
        let height = usize::from(height_u16);
        let patch_pixels = width.checked_mul(height).unwrap_or(usize::MAX);
        if width == 0
            || height == 0
            || left.checked_add(width).is_none_or(|end| end > state.width)
            || top.checked_add(height).is_none_or(|end| end > state.height)
            || frame.buffer.len() != patch_pixels
            || frame.needs_user_input
            || state.frame_count >= MAX_FRAMES
            || state
                .patch_pixels
                .checked_add(patch_pixels)
                .is_none_or(|total| total > MAX_PATCH_PIXELS)
        {
            return -4;
        }

        let palette = frame.palette.as_deref().or(state.global_palette.as_deref());
        let delay = frame.delay;
        let disposal = match frame.dispose {
            DisposalMethod::Any => 0u8,
            DisposalMethod::Keep => 1u8,
            DisposalMethod::Background => 2u8,
            DisposalMethod::Previous => 3u8,
        };
        let transparent_index = frame.transparent.unwrap_or(0);
        let transparent_present = u8::from(frame.transparent.is_some());
        let Some(palette) = palette else {
            return -5;
        };
        if palette.is_empty()
            || palette.len() % 3 != 0
            || palette.len() > 768
            || (transparent_present == 1 && usize::from(transparent_index) >= palette.len() / 3)
            || frame.buffer.len() != patch_pixels
            || frame
                .buffer
                .iter()
                .any(|index| usize::from(*index) >= palette.len() / 3)
        {
            return -6;
        }

        let required = match FRAME_HEADER_BYTES
            .checked_add(palette.len())
            .and_then(|n| n.checked_add(frame.buffer.len()))
        {
            Some(required) if required <= output_capacity && required <= i32::MAX as usize => {
                required
            }
            _ => return -7,
        };
        let output = slice::from_raw_parts_mut(output_pointer, required);
        put_u16(output, 0, left_u16);
        put_u16(output, 2, top_u16);
        put_u16(output, 4, width_u16);
        put_u16(output, 6, height_u16);
        put_u16(output, 8, delay);
        output[10] = disposal;
        output[11] = transparent_index;
        output[12] = transparent_present;
        output[13] = 0;
        put_u16(output, 14, palette.len() as u16);
        put_u32(output, 16, frame.buffer.len() as u32);
        output[FRAME_HEADER_BYTES..FRAME_HEADER_BYTES + palette.len()].copy_from_slice(&palette);
        output[FRAME_HEADER_BYTES + palette.len()..required].copy_from_slice(&frame.buffer);

        state.frame_count += 1;
        state.patch_pixels += patch_pixels;
        required as i32
    })
}

#[no_mangle]
pub extern "C" fn decoder_free(handle: i32) {
    if handle <= 0 {
        return;
    }
    DECODERS.with(|decoders| {
        if let Some(slot) = decoders.borrow_mut().get_mut((handle - 1) as usize) {
            *slot = None;
        }
    });
}

fn put_u16(target: &mut [u8], offset: usize, value: u16) {
    target[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
}

fn put_u32(target: &mut [u8], offset: usize, value: u32) {
    target[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}

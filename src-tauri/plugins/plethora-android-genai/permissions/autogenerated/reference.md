## Default Permission

Allows the android-genai plugin's on-device generative AI commands to be invoked
from the frontend. On Android these drive ML Kit GenAI (Gemini Nano via AICore)
for capability detection, summarization, free-form prompting, and ML Kit OCR,
plus the EmbeddingGemma embedding backend (status/download/embed commands,
design D10); everywhere else the status commands report `platform_unsupported`
and the inference commands return a typed error so callers fall back to a
cloud provider or lexical-only mode.

#### This default permission set includes the following:

- `allow-ondevice-ai-status`
- `allow-ondevice-ai-capabilities`
- `allow-ondevice-ai-generate`
- `allow-ondevice-ai-count-tokens`
- `allow-ondevice-ai-warm-up`
- `allow-ondevice-ai-summarize`
- `allow-ondevice-ai-prompt`
- `allow-ondevice-ai-download`
- `allow-ondevice-ai-start-prompt-stream`
- `allow-ondevice-ai-cancel-prompt-request`
- `allow-ondevice-ai-cancel`
- `allow-ondevice-ai-ocr-labels`
- `allow-ondevice-ai-describe-image`
- `allow-ondevice-ai-embed-status`
- `allow-ondevice-ai-embed-download`
- `allow-ondevice-ai-embed-texts`

## Permission Table

<table>
<tr>
<th>Identifier</th>
<th>Description</th>
</tr>


<tr>
<td>

`plethora-android-genai:allow-ondevice-ai-cancel`

</td>
<td>

Enables the ondevice_ai_cancel command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-genai:deny-ondevice-ai-cancel`

</td>
<td>

Denies the ondevice_ai_cancel command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-genai:allow-ondevice-ai-cancel-prompt-request`

</td>
<td>

Enables the ondevice_ai_cancel_prompt_request command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-genai:deny-ondevice-ai-cancel-prompt-request`

</td>
<td>

Denies the ondevice_ai_cancel_prompt_request command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-genai:allow-ondevice-ai-capabilities`

</td>
<td>

Enables the ondevice_ai_capabilities command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-genai:deny-ondevice-ai-capabilities`

</td>
<td>

Denies the ondevice_ai_capabilities command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-genai:allow-ondevice-ai-count-tokens`

</td>
<td>

Enables the ondevice_ai_count_tokens command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-genai:deny-ondevice-ai-count-tokens`

</td>
<td>

Denies the ondevice_ai_count_tokens command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-genai:allow-ondevice-ai-describe-image`

</td>
<td>

Enables the ondevice_ai_describe_image command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-genai:deny-ondevice-ai-describe-image`

</td>
<td>

Denies the ondevice_ai_describe_image command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-genai:allow-ondevice-ai-download`

</td>
<td>

Enables the ondevice_ai_download command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-genai:deny-ondevice-ai-download`

</td>
<td>

Denies the ondevice_ai_download command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-genai:allow-ondevice-ai-embed-download`

</td>
<td>

Enables the ondevice_ai_embed_download command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-genai:deny-ondevice-ai-embed-download`

</td>
<td>

Denies the ondevice_ai_embed_download command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-genai:allow-ondevice-ai-embed-status`

</td>
<td>

Enables the ondevice_ai_embed_status command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-genai:deny-ondevice-ai-embed-status`

</td>
<td>

Denies the ondevice_ai_embed_status command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-genai:allow-ondevice-ai-embed-texts`

</td>
<td>

Enables the ondevice_ai_embed_texts command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-genai:deny-ondevice-ai-embed-texts`

</td>
<td>

Denies the ondevice_ai_embed_texts command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-genai:allow-ondevice-ai-generate`

</td>
<td>

Enables the ondevice_ai_generate command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-genai:deny-ondevice-ai-generate`

</td>
<td>

Denies the ondevice_ai_generate command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-genai:allow-ondevice-ai-ocr-labels`

</td>
<td>

Enables the ondevice_ai_ocr_labels command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-genai:deny-ondevice-ai-ocr-labels`

</td>
<td>

Denies the ondevice_ai_ocr_labels command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-genai:allow-ondevice-ai-prompt`

</td>
<td>

Enables the ondevice_ai_prompt command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-genai:deny-ondevice-ai-prompt`

</td>
<td>

Denies the ondevice_ai_prompt command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-genai:allow-ondevice-ai-start-prompt-stream`

</td>
<td>

Enables the ondevice_ai_start_prompt_stream command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-genai:deny-ondevice-ai-start-prompt-stream`

</td>
<td>

Denies the ondevice_ai_start_prompt_stream command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-genai:allow-ondevice-ai-status`

</td>
<td>

Enables the ondevice_ai_status command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-genai:deny-ondevice-ai-status`

</td>
<td>

Denies the ondevice_ai_status command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-genai:allow-ondevice-ai-summarize`

</td>
<td>

Enables the ondevice_ai_summarize command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-genai:deny-ondevice-ai-summarize`

</td>
<td>

Denies the ondevice_ai_summarize command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-genai:allow-ondevice-ai-warm-up`

</td>
<td>

Enables the ondevice_ai_warm_up command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-genai:deny-ondevice-ai-warm-up`

</td>
<td>

Denies the ondevice_ai_warm_up command without any pre-configured scope.

</td>
</tr>
</table>

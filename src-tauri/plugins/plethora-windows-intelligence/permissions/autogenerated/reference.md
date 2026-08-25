## Default Permission

Allows the Windows on-device intelligence plugin commands. Off Windows the
Rust shims return platform_unsupported; on Windows the plugin probes package
identity, OS version, and WinRT readiness before serving Phi Silica requests.

#### This default permission set includes the following:

- `allow-windows-capabilities`
- `allow-windows-lm-generate`
- `allow-windows-lm-generate-stream`
- `allow-windows-lm-cancel`
- `allow-windows-lm-warmup`
- `allow-windows-lm-ensure-ready`
- `allow-windows-ocr-status`
- `allow-windows-ocr-recognize`
- `allow-windows-lm-diagnostics`

## Permission Table

<table>
<tr>
<th>Identifier</th>
<th>Description</th>
</tr>


<tr>
<td>

`plethora-windows-intelligence:allow-windows-capabilities`

</td>
<td>

Enables the windows_capabilities command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-windows-intelligence:deny-windows-capabilities`

</td>
<td>

Denies the windows_capabilities command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-windows-intelligence:allow-windows-lm-cancel`

</td>
<td>

Enables the windows_lm_cancel command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-windows-intelligence:deny-windows-lm-cancel`

</td>
<td>

Denies the windows_lm_cancel command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-windows-intelligence:allow-windows-lm-diagnostics`

</td>
<td>

Enables the windows_lm_diagnostics command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-windows-intelligence:deny-windows-lm-diagnostics`

</td>
<td>

Denies the windows_lm_diagnostics command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-windows-intelligence:allow-windows-lm-ensure-ready`

</td>
<td>

Enables the windows_lm_ensure_ready command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-windows-intelligence:deny-windows-lm-ensure-ready`

</td>
<td>

Denies the windows_lm_ensure_ready command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-windows-intelligence:allow-windows-lm-generate`

</td>
<td>

Enables the windows_lm_generate command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-windows-intelligence:deny-windows-lm-generate`

</td>
<td>

Denies the windows_lm_generate command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-windows-intelligence:allow-windows-lm-generate-stream`

</td>
<td>

Enables the windows_lm_generate_stream command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-windows-intelligence:deny-windows-lm-generate-stream`

</td>
<td>

Denies the windows_lm_generate_stream command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-windows-intelligence:allow-windows-lm-warmup`

</td>
<td>

Enables the windows_lm_warmup command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-windows-intelligence:deny-windows-lm-warmup`

</td>
<td>

Denies the windows_lm_warmup command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-windows-intelligence:allow-windows-ocr-recognize`

</td>
<td>

Enables the windows_ocr_recognize command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-windows-intelligence:deny-windows-ocr-recognize`

</td>
<td>

Denies the windows_ocr_recognize command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-windows-intelligence:allow-windows-ocr-status`

</td>
<td>

Enables the windows_ocr_status command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-windows-intelligence:deny-windows-ocr-status`

</td>
<td>

Denies the windows_ocr_status command without any pre-configured scope.

</td>
</tr>
</table>

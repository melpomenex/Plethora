/**
 * Material 3 primitive library for Plethora.
 *
 * Docs: docs/design-system.md. Rules of thumb:
 * - consume semantic tokens only (no color literals in className);
 * - prefer these primitives over hand-rolled controls;
 * - Dialog vs Sheet vs Menu vs Snackbar: see docs/design-system.md#surfaces.
 */
export { Button, buttonVariants, type ButtonProps } from "./Button";
export { IconButton, iconButtonVariants, type IconButtonProps } from "./IconButton";
export { Fab, fabVariants, type FabProps } from "./Fab";
export { Chip, chipVariants, type ChipProps } from "./Chip";
export { SegmentedButton, type SegmentedButtonProps, type SegmentedOption } from "./SegmentedButton";
export { Menu, type MenuProps, type MenuItemSpec } from "./Menu";
export { ListItem, Divider, type ListItemProps } from "./ListItem";
export { TextField, SearchField, type TextFieldProps } from "./TextField";
export { Checkbox, Radio } from "./Selection";
export { Slider } from "./Slider";
export { LinearProgress, CircularProgress } from "./Progress";
export { Tooltip } from "./Tooltip";
export { Dialog, dialogSurface, type DialogProps } from "./Dialog";

// Switch is adopted from its established accessible implementation rather
// than duplicated here.
export { Switch } from "../common/Switch";

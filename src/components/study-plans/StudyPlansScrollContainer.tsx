import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { bottomDockClearance, useBottomControlsGeometry } from "../mobile/BottomControlsGeometry";
import { SafeScrollContainer } from "../adaptive/SafeScrollContainer";

type StudyPlansScrollStyle = CSSProperties & {
  "--study-plans-bottom-clearance"?: string;
};

export function StudyPlansScrollContainer({
  children,
  className,
  style,
  ...props
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  const controls = useBottomControlsGeometry();
  const scrollStyle: StudyPlansScrollStyle = {
    ...style,
    ...(controls ? { "--study-plans-bottom-clearance": `${bottomDockClearance(controls)}px` } : {}),
  };

  return (
    <SafeScrollContainer
      className={`study-plans-scroll${className ? ` ${className}` : ""}`}
      style={scrollStyle}
      {...props}
    >
      {children}
    </SafeScrollContainer>
  );
}

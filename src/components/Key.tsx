export interface KeyProps {
  children: React.ReactNode;
  size?: "sm" | "md" | "lg";
  pressed?: boolean;
}

export function Key({ children, size = "md", pressed = false }: KeyProps) {
  const sizeMap = {
    sm: "px-2 py-0.5 text-xs",
    md: "px-2.5 py-0.5 text-md",
    lg: "px-3 py-1 text-base",
  };

  return (
    <kbd
      aria-hidden="false"
      className={`rounded-md border shadow-sm select-none align-middle inline-flex items-center justify-center 
                 border-gray-300 bg-gray-100 text-gray-800 font-medium ${sizeMap[size]}
                 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100
                 `}
    >
      {children}
    </kbd>
  );
}
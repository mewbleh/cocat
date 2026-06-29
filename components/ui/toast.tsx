"use client";

import { Toaster as SonnerToaster, toast } from "sonner";

function Toaster() {
  return (
    <SonnerToaster
      closeButton
      richColors
      toastOptions={{
        classNames: {
          toast: "rounded-md border-border"
        }
      }}
    />
  );
}

export { Toaster, toast };

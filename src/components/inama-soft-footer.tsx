import { Github, Globe2, Heart, Linkedin, Mail, MapPin, Phone } from "lucide-react";
import { cn } from "@/lib/utils";

type InamaSoftFooterProps = {
  className?: string;
};

export function InamaSoftFooter({ className }: InamaSoftFooterProps) {
  return (
    <footer
      className={cn(
        "border-t border-border/40 bg-background/50 px-4 py-2 sm:px-6 text-[11px] text-muted-foreground/60 transition-colors",
        className
      )}
    >
      <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
        {/* Left: subtle brand & copyright */}
        <div className="flex items-center gap-2">
          <img
            src="/inama-soft-logo.ico"
            alt="Inama Soft"
            className="h-4 w-4 rounded object-contain opacity-70"
          />
          <span className="font-medium text-foreground/80">Inama Soft</span>
          <span>·</span>
          <span>Mousa Gamil Al-Awadhi</span>
          <span className="hidden sm:inline">·</span>
          <span className="hidden sm:inline-flex items-center gap-1">
            <MapPin className="h-3 w-3" /> Ibb, Yemen
          </span>
        </div>

        {/* Right: minimal contact & social links */}
        <div className="flex items-center gap-3">
          <a
            href="tel:+967772217218"
            className="hidden sm:inline-flex items-center gap-1 transition-colors hover:text-foreground"
          >
            <Phone className="h-3 w-3" />
            <span>+967 772 217 218</span>
          </a>
          <a
            href="https://inma-soft.vercel.app"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
          >
            <Globe2 className="h-3 w-3" />
            <span>Website</span>
          </a>
          <a
            href="https://github.com/mosaa65"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
          >
            <Github className="h-3 w-3" />
            <span>GitHub</span>
          </a>
        </div>
      </div>
    </footer>
  );
}

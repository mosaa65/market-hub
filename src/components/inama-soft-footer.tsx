import { Github, Globe2, Heart, Linkedin, Mail, MapPin, Phone } from "lucide-react";

import { cn } from "@/lib/utils";

type InamaSoftFooterProps = {
  className?: string;
};

export function InamaSoftFooter({ className }: InamaSoftFooterProps) {
  return (
    <footer
      className={cn("border-t border-border/60 bg-background/70 px-4 py-6 sm:px-6", className)}
    >
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-5 text-sm text-muted-foreground">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <img
              src="/inama-soft-logo.ico"
              alt="Inama Soft logo"
              className="h-11 w-11 rounded-xl object-contain ring-1 ring-border/70"
            />
            <div>
              <p className="font-semibold text-foreground">Inama Soft</p>
              <p className="text-xs">Collaborative Development Group</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" />
              Ibb, Yemen
            </span>
            <a
              className="inline-flex items-center gap-1.5 transition-colors hover:text-primary"
              href="mailto:mousa.mc13@gmail.com"
            >
              <Mail className="h-3.5 w-3.5" />
              mousa.mc13@gmail.com
            </a>
            <a
              className="inline-flex items-center gap-1.5 transition-colors hover:text-primary"
              href="tel:+967772217218"
            >
              <Phone className="h-3.5 w-3.5" />
              +967 772 217 218
            </a>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-border/50 pt-4 text-xs sm:flex-row sm:items-center sm:justify-between">
          <p className="inline-flex flex-wrap items-center gap-1.5">
            Made with <Heart className="h-3.5 w-3.5 fill-primary text-primary" aria-label="love" />{" "}
            by <span className="font-medium text-foreground">Inama Soft</span>
            <span aria-hidden="true">·</span>
            <span>Mousa Gamil Al-Awadhi</span>
          </p>
          <nav
            className="flex flex-wrap items-center gap-x-3 gap-y-2"
            aria-label="Inama Soft links"
          >
            <a
              className="inline-flex items-center gap-1 hover:text-primary"
              href="https://inma-soft.vercel.app"
              target="_blank"
              rel="noreferrer"
            >
              <Globe2 className="h-3.5 w-3.5" />
              Website
            </a>
            <a
              className="inline-flex items-center gap-1 hover:text-primary"
              href="https://www.linkedin.com/in/mousa-al-awadhi-6518633a8"
              target="_blank"
              rel="noreferrer"
            >
              <Linkedin className="h-3.5 w-3.5" />
              LinkedIn
            </a>
            <a
              className="inline-flex items-center gap-1 hover:text-primary"
              href="https://github.com/mosaa65"
              target="_blank"
              rel="noreferrer"
            >
              <Github className="h-3.5 w-3.5" />
              GitHub
            </a>
          </nav>
        </div>
      </div>
    </footer>
  );
}

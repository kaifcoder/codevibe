import { cn } from "@/lib/utils";

export const BentoGrid = ({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) => {
  return (
    <div
      data-bento-grid
      className={cn(
        "mx-auto grid max-w-7xl grid-cols-1 gap-4 md:auto-rows-[20rem] md:grid-cols-3",
        className,
      )}
    >
      {children}
    </div>
  );
};

export const BentoGridItem = ({
  className,
  title,
  description,
  header,
  icon,
}: {
  className?: string;
  title?: string | React.ReactNode;
  description?: string | React.ReactNode;
  header?: React.ReactNode;
  icon?: React.ReactNode;
}) => {
  return (
    <div
      className={cn(
        "group/bento relative row-span-1 flex flex-col justify-between gap-4 overflow-hidden rounded-2xl border border-border/60 bg-white p-5 shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset,0_30px_60px_-30px_rgba(0,0,0,0.5)] transition-all duration-300 hover:-translate-y-0.5 hover:border-blue-500/40 hover:shadow-2xl dark:bg-white/[0.025] dark:hover:shadow-blue-500/10",
        className,
      )}
    >
      <div className="relative min-h-[10rem] flex-1 overflow-hidden rounded-xl">
        {header}
      </div>
      <div className="transition-transform duration-200 group-hover/bento:translate-x-1.5">
        {icon}
        <div className="mt-2 mb-1 font-sans font-medium text-neutral-800 dark:text-neutral-100">
          {title}
        </div>
        <div className="font-sans text-xs font-normal leading-relaxed text-neutral-600 dark:text-neutral-400">
          {description}
        </div>
      </div>
    </div>
  );
};

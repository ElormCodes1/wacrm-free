import type { CompanyBranding } from '@/lib/tenancy/branding';

/**
 * A company's logo, or a coloured initial when it has none.
 *
 * Always renders something recognisable: a blank space where the logo
 * should be reads as a broken page, which is the opposite of the point —
 * this exists so a person can confirm whose system they are looking at
 * before they trust it with a password.
 */
export function CompanyBrandMark({
  branding,
  size = 'md',
}: {
  branding: Pick<CompanyBranding, 'name' | 'logoUrl' | 'brandColor'>;
  size?: 'md' | 'lg';
}) {
  const dimension = size === 'lg' ? 'h-16 w-16' : 'h-10 w-10';
  const text = size === 'lg' ? 'text-2xl' : 'text-base';

  if (branding.logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={branding.logoUrl}
        alt={branding.name}
        className={`${dimension} mx-auto rounded-xl object-contain`}
      />
    );
  }

  return (
    <div
      className={`${dimension} ${text} bg-primary text-primary-foreground mx-auto flex items-center justify-center rounded-xl font-semibold`}
      style={branding.brandColor ? { backgroundColor: branding.brandColor } : undefined}
      aria-hidden="true"
    >
      {branding.name.trim().charAt(0).toUpperCase() || '?'}
    </div>
  );
}

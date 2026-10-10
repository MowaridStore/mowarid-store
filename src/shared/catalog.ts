// Support legacy cached relative URLs as well as the current HTTPS contract.
export function catalogImages(images: unknown, parentImages?: unknown): string[] {
  const normalize = (value: unknown) => {
    if (!Array.isArray(value)) return [];
    return value.flatMap((image) => {
      if (typeof image !== 'string' || !image || image.length > 2000) return [];
      try {
        const url = new URL(image, 'https://mowarid.ma');
        return url.protocol === 'https:' && !url.username && !url.password ? [url.href] : [];
      } catch {
        return [];
      }
    });
  };
  const own = normalize(images);
  return own.length ? own : normalize(parentImages);
}
export function catalogMedia(
  product: { main_image?: unknown; images?: unknown },
  parent?: { main_image?: unknown; images?: unknown },
) {
  const own = catalogImages(product.images);
  const main = catalogImages([product.main_image])[0] || own[0];
  const images = main
    ? [...new Set([main, ...own])]
    : catalogImages([parent?.main_image, ...catalogImages(parent?.images)]);
  return { main_image: images[0] || null, images };
}

// Optional supplier metadata is imported only when explicitly provided.
export function catalogKeywords(
  product: Record<string, unknown>,
  parent?: Record<string, unknown>,
): string {
  for (const source of [
    product.search_keywords,
    product.keywords,
    product.tags,
    parent?.search_keywords,
    parent?.keywords,
    parent?.tags,
  ]) {
    const values = Array.isArray(source)
      ? source
      : typeof source === 'string'
        ? source.split(/[,;،\n]+/)
        : [];
    const words = [
      ...new Set(
        values
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ];
    if (words.length) return words.join(', ').slice(0, 1000);
  }
  return '';
}
export function catalogDescriptions(product: Record<string, any>, parent?: Record<string, any>) {
  const base = product.description ?? parent?.description ?? '';
  const html =
    product.description_html ??
    product.html_description ??
    parent?.description_html ??
    parent?.html_description;
  const text =
    product.description_text ??
    product.plain_description ??
    parent?.description_text ??
    parent?.plain_description;
  return {
    html: typeof html === 'string' && html ? html : typeof base === 'string' ? base : '',
    text: typeof text === 'string' && text ? text : typeof base === 'string' ? base : '',
  };
}

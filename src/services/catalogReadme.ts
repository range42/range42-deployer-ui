import MarkdownIt from 'markdown-it'

// Repository Markdown is untrusted. Do not enable HTML or HTML-producing plugins.
const markdown = new MarkdownIt({ html: false, linkify: false })
const defaultValidateLink = markdown.validateLink.bind(markdown)
markdown.validateLink = url => {
  if (!defaultValidateLink(url)) return false
  try { return ['https:', 'http:'].includes(new URL(url).protocol) }
  catch { return false } // Relative repository references must not navigate the app.
}
markdown.renderer.rules.link_open = (tokens, index, options, _env, renderer) => {
  tokens[index].attrSet('target', '_blank')
  tokens[index].attrSet('rel', 'noopener noreferrer')
  return renderer.renderToken(tokens, index, options)
}
markdown.renderer.rules.image = (tokens, index, options, env, renderer) => {
  const token = tokens[index]
  const destination = String(token.attrGet('src') || '')
  const label = renderer.renderInlineAsText(token.children || [], options, env) || destination
  // No <img>, including for relative or embedded images: viewing never loads assets.
  return `<a href="${markdown.utils.escapeHtml(destination)}" target="_blank" rel="noopener noreferrer">${markdown.utils.escapeHtml(label)}</a>`
}
markdown.renderer.rules.table_open = (tokens, index, options, _env, renderer) => {
  tokens[index].attrSet('tabindex', '0')
  return renderer.renderToken(tokens, index, options)
}
for (const rule of ['heading_open', 'heading_close']) {
  markdown.renderer.rules[rule] = (tokens, index, options, _env, renderer) => {
    const token = tokens[index]
    token.tag = `h${Math.min(6, Number(token.tag.slice(1)) + 2)}`
    return renderer.renderToken(tokens, index, options)
  }
}

/** The sole HTML boundary for README presentation; all source HTML remains text. */
export function renderCatalogReadme(source: string): string {
  return markdown.render(source)
}

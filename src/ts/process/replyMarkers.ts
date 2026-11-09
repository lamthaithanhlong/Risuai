/** Remove §…§ wrappers (keep inner content) and any stray §. */
export function stripMarkers(text: string): string {
    if (!text) return ''
    // Remove §...§ wrappers, keep inner content
    let out = text.replace(/§([^§]*)§/g, '$1')
    // Remove any remaining stray §
    out = out.replace(/§/g, '')
    return out
}
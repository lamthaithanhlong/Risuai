export function ollamaNeedsProsePass(content: string, thinking: string, doneReason: string | undefined): boolean {
    return doneReason === 'length' && thinking.trim() !== '' && content.trim() === ''
}

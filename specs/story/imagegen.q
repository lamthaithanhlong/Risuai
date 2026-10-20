// the next reply is refused a picture although nothing failed
E<> (Next.Blocked && !failed)
// after a real failure the cooldown still holds (the fix keeps the protection)
E<> (Next.Blocked && failed)

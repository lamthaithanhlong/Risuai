// the longest the user can wait for the first visible word (ms), over every timing the model allows
sup{reply.Thinking || reply.FirstToken || reply.Prepare}: t
// is the wait always within LIMIT?
A[] (reply.Prepare || reply.FirstToken || reply.Thinking) imply t <= LIMIT

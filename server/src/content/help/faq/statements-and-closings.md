---
slug: statements-and-closings
title: How do I add a line the canvasser reads but the voter doesn't answer, or more than one closing?
audience: lead
kind: faq
order: 76
sourceDoc: SURVEYS.md
summary: Add a statement for words read aloud that take no answer, and a closing block for each goodbye — the Closing box is the goodbye for every path that reaches none of them.
tags: survey, script, statement, closing, default closing, read aloud, go to, then go to, several closings, builder
---

With two kinds of block in the survey builder that are read aloud and record nothing: **statements** and **closings**. Neither takes a question number, and neither ever shows up in results, exports or on a voter's page — only questions record answers.

## A line to read aloud: a statement

Click **+ Add statement** under the question list and type the words into **Read aloud** — a full paragraph is fine. Use it for anything the canvasser says that the voter doesn't answer: a short pitch to an undecided voter, a follow-up line after a question, a fact about the race. Give it a **Title** if you like ("The pitch"); that's how it's named in the builder, on the phone and on paper.

A statement records nothing, so if your pitch ends in a question you want answered ("Having heard that, can she count on your support?"), add that as a real question right after it. Anything asked inside a statement is just conversation.

On the phone a statement is an amber **Read aloud** box. On paper it prints once, on the packet's *What to say* page.

## More than one goodbye: closings

Yes — as many as your script has endings. Click **+ Add closing** for each one and give it a title ("Close 1", "Close 2"). Then point the answers that should end there at it with **then go to**. A closing shows only in the conversations that lead to it.

Two things make this work:

- **The Closing box at the bottom of the builder is the default closing** — the goodbye on any path that reaches none of your closing blocks. Put your plain "Thank you for your time" there rather than in a block, and every conversation still ends on a goodbye.
- **Closings can run into each other.** Set a closing's own *then go to* to another closing — a voting-dates reminder that runs into a "find your polling place" goodbye — and the last one to **End the conversation**. A closing left on *Continue* runs into whatever block sits under it.

## An example

A support script, written as arrows:

- **Q1** "Can she count on your support?" — Yes → Q3 · No → End · Undecided → The pitch
- **Statement "The pitch"** — a paragraph about the candidate; continues to Q2
- **Q2** "Having heard that, can she count on your support?" — Yes → Q3 · Still undecided → Close 2 · No → End
- **Q3** "How do you plan to vote?" — continues to Close 1
- **Closing "Close 1"** — the voting dates (typed as words) and a reminder to make a plan → Close 2
- **Closing "Close 2"** — two links, the campaign website and the polling-place lookup → End
- **The Closing box** — "Thank you for your time today. Have a good day!"

A supporter hears Close 1 and then Close 2; a voter still undecided after the pitch hears Close 2 alone; a No at either question ends on the default closing. Arrows only point down the list, which is why Q3 sits below Q2: both Yes answers lead to it. Q1 and Q2 are marked **Required**, because a question whose answers carry arrows needs an answer to know where to go.

Your client's script may send *Refused* to a closing. Leave that answer out: a refusal is never a survey answer — the canvasser backs out of the survey and taps **Refused** on the door screen. The one exception: if they've already surveyed someone else at that door this round, they leave the door as it is, because tapping Refused would replace their result for the door and delete the answers they took there.

Before it goes out, open the survey's **Preview** and use **Try it** to walk every path. The full guide is [Building and assigning surveys](surveys).

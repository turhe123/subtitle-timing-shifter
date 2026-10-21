# Subtitle Timing Shifter — specification

**Tagline:** Shift or stretch SRT and VTT subtitle timing to fix out of sync captions in your browser, no upload.

**Category:** Audio & Video

**Free alternative to:** Subtitle Tools Sync and online subtitle shifters (upload the subtitle file, ads, daily limits and accounts for extra features)

**Search phrases:** subtitle sync, shift srt time, subtitles out of sync fix, srt delay, adjust subtitle timing, srt time shift online, change frame rate subtitles

**Allowed libraries:** none (browser APIs only)

**Published at:** https://turhe123.github.io/subtitle-timing-shifter/

## Acceptance checks (each must have a test)

- Loading sample.srt and shifting by plus 2.5 seconds moves the first cue from 00:00:01,000 to 00:00:03,500
- A negative shift that would go below zero clamps and shows a warning
- Two point sync mapping the first and last cue to new times rescales middle cues
- The preview table shows old and new times side by side
- The download keeps the original format (SRT or VTT)
- Works at 390px wide

## Spec

Out of sync subtitles are a very common annoyance. People search for subtitle sync, srt delay and shift srt time. The known web tools require uploading the file, limit the number of fixes per day, and bury the simple offset field under ads. Our tool does only timing: it moves or rescales all cue times in an SRT or VTT file and saves the result.

Feature set: load one SRT or VTT file or paste text. Three modes in tabs. Offset: add or subtract a number of seconds and milliseconds, with plus and minus buttons for 0.1 and 1 second steps. Two point sync: the user enters the correct start time for the first cue and the correct start time for a later chosen cue, and the tool computes a linear scale and offset applied to all cues, which fixes drift. Frame rate conversion: choose source and target frame rates such as 23.976, 24, 25 and 29.97 to scale the times by their ratio. Optionally apply the change only to cues after a chosen number. Clamp negative times to zero and report how many cues were affected.

UI: a drop zone and paste area above the fold, then the mode tabs with their inputs. A live table lists the first twenty cues with index, old start, new start and text, scrollable to see all. A summary line shows cue count, the shift amount and warnings. The Download button keeps the input extension and adds the suffix synced. A Copy text button is also provided. Empty state shows an example. Errors for unreadable files appear inline. Keyboard: arrow up and down in the offset field step by 0.1 second, and shift multiplies by ten.

Technical approach: decode the file bytes with TextDecoder after checking for a UTF-8 or UTF-16 byte order mark, falling back to Windows-1252. Parse cues with a tolerant parser that accepts comma or dot milliseconds and optional hours in VTT. Store times as integer milliseconds to avoid float drift. Compute new time as round of scale times old plus offset. Serialize in the same format as the input, preserving cue text, identifiers, VTT headers, notes and settings untouched. Create a Blob and an object URL for download. The work is simple string and arithmetic and needs no library or worker.

Edge cases: files with Windows or Mac line endings, empty cues, cues that end up with end time before start time after scaling, offsets larger than the video length, decimal separators typed with a comma by users in some locales, very large files, right to left text, and Unicode. Preserve line breaks and tags exactly. If the byte encoding was not UTF-8, save as UTF-8 and say so.

Demo data: a fictional eight cue subtitle file for a short film called Paper Moon Cafe where all cues are two seconds late, so a minus 2.0 second shift produces a visibly correct result.

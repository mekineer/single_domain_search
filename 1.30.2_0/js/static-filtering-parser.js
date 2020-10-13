/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2020-present Raymond Hill

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uBlock
*/

'use strict';

/*******************************************************************************

    The goal is for the static filtering parser to avoid external
    dependencies to other code in the project.

    Roughly, this is how things work: each input string (passed to analyze())
    is decomposed into a minimal set of distinct slices. Each slice is a
    triplet of integers consisiting of:

    - a bit vector describing the characters inside the slice
    - an index of where in the origin string the slice starts
    - a length for the number of character in the slice

    Slice descriptor are all flatly stored in an array of integer so as to
    avoid the need for a secondary data structure. Example:

    raw string: toto.com
                  toto         .           com
                  |            |           |
        slices: [ 65536, 0, 4, 1024, 4, 1, 65536, 5, 3 ]
                  ^      ^  ^
                  |      |  |
                  |      |  +---- number of characters
                  |      +---- index in raw string
                  +---- bit vector

    Thus the number of slices to describe the `toto.com` string is made of
    three slices, encoded into nine integers.

    Once a string has been encoded into slices, the parser will only work
    with those slices in order to parse the filter represented by the
    string, rather than performing string operations on the original string.
    The result is that parsing is essentially number-crunching operations
    rather than string operations, for the most part (potentially opening
    the door for WASM code in the future to parse static filters).

    The array used to hold the slices is reused across string analysis, in
    order to eliminate memory churning.

    Above the slices, there are various span objects used to describe
    consecutive sequences of slices and which are filled in as a result
    of parsing.

**/

{
// >>>>> start of local scope

/******************************************************************************/

const Parser = class {
    constructor(options = {}) {
        this.interactive = options.interactive === true;
        this.raw = '';
        this.slices = [];
        this.leftSpaceSpan = new Span();
        this.exceptionSpan = new Span();
        this.patternLeftAnchorSpan = new Span();
        this.patternSpan = new Span();
        this.patternRightAnchorSpan = new Span();
        this.optionsAnchorSpan = new Span();
        this.optionsSpan = new Span();
        this.commentSpan = new Span();
        this.rightSpaceSpan = new Span();
        this.eolSpan = new Span();
        this.spans = [
            this.leftSpaceSpan,
            this.exceptionSpan,
            this.patternLeftAnchorSpan,
            this.patternSpan,
            this.patternRightAnchorSpan,
            this.optionsAnchorSpan,
            this.optionsSpan,
            this.commentSpan,
            this.rightSpaceSpan,
            this.eolSpan,
        ];
        this.patternTokenIterator = new PatternTokenIterator(this);
        this.netOptionsIterator = new NetOptionsIterator(this);
        this.extOptionsIterator = new ExtOptionsIterator(this);
        this.maxTokenLength = Number.MAX_SAFE_INTEGER;
        this.reIsLocalhostRedirect = /(?:0\.0\.0\.0|(?:broadcast|local)host|local|ip6-\w+)(?:[^\w.-]|$)/;
        this.reHostname = /^[^\x00-\x24\x26-\x29\x2B\x2C\x2F\x3A-\x40\x5B-\x5E\x60\x7B-\x7F]+/;
        this.reHostsSink = /^[\w-.:\[\]]+$/;
        this.reHostsSource = /^[^\x00-\x24\x26-\x29\x2B\x2C\x2F\x3A-\x40\x5B-\x5E\x60\x7B-\x7F]+$/;
        this.reUnicodeChar = /[^\x00-\x7F]/;
        this.reUnicodeChars = /[^\x00-\x7F]/g;
        this.reHostnameLabel = /[^.]+/g;
        this.rePlainHostname = /^(?:[\w-]+\.)*[a-z]+$/;
        this.rePlainEntity = /^(?:[\w-]+\.)+\*$/;
        this.reEntity = /^[^*]+\.\*$/;
        this.punycoder = new URL(self.location);
        this.selectorCompiler = new this.SelectorCompiler(this);
        // TODO: reuse for network filtering analysis
        this.result = {
            exception: false,
            raw: '',
            compiled: '',
            pseudoclass: false,
        };
        this.reset();
    }

    reset() {
        this.sliceWritePtr = 0;
        this.category = CATNone;
        this.allBits = 0;       // bits found in any slices
        this.patternBits = 0;   // bits found in any pattern slices
        this.optionsBits = 0;   // bits found in any option slices
        this.flavorBits = 0;
        for ( const span of this.spans ) { span.reset(); }
        this.pattern = '';
    }

    analyze(raw) {
        this.slice(raw);
        let slot = this.leftSpaceSpan.len;
        if ( slot === this.rightSpaceSpan.i ) { return; }

        // test for `!`, `#`, or `[`
        if ( hasBits(this.slices[slot], BITLineComment) ) {
            // static extended filter?
            if ( hasBits(this.slices[slot], BITHash) ) {
                this.analyzeExt(slot);
                if ( this.category === CATStaticExtFilter ) { return; }
            }
            // if not `#`, no ambiguity
            this.category = CATComment;
            return;
        }

        // assume no inline comment
        this.commentSpan.i = this.rightSpaceSpan.i;

        // extended filtering with options?
        if ( hasBits(this.allBits, BITHash) ) {
            let hashSlot = this.findFirstMatch(slot, BITHash);
            if ( hashSlot !== -1 ) {
                this.analyzeExt(hashSlot);
                if ( this.category === CATStaticExtFilter ) { return; }
                // inline comment? (a space followed by a hash)
                if ( (this.allBits & BITSpace) !== 0 ) {
                    for (;;) {
                        if ( hasBits(this.slices[hashSlot-3], BITSpace) ) {
                            this.commentSpan.i = hashSlot-3;
                            this.commentSpan.len = this.rightSpaceSpan.i - hashSlot;
                            break;
                        }
                        hashSlot = this.findFirstMatch(hashSlot + 6, BITHash);
                        if ( hashSlot === -1 ) { break; }
                    }
                }
            }
        }
        // assume network filtering
        this.analyzeNet();
    }

    // Use in syntax highlighting contexts
    analyzeExtra() {
        if ( this.category === CATStaticExtFilter ) {
            this.analyzeExtExtra();
        } else if ( this.category === CATStaticNetFilter ) {
            this.analyzeNetExtra();
        }
    }

    // Static extended filters are all of the form:
    //
    // 1. options (optional): a comma-separated list of hostnames
    // 2. anchor: regex equivalent => /^#@?[\$\??|%|\?)?#$/
    // 3. pattern
    //
    // Return true if a valid extended filter is found, otherwise false.
    // When a valid extended filter is found:
    //     optionsSpan: first slot which contains options
    //     optionsAnchorSpan: first slot to anchor
    //     patternSpan: first slot to pattern
    analyzeExt(from) {
        let end = this.rightSpaceSpan.i;
        // Number of consecutive #s.
        const len = this.slices[from+2];
        // More than 3 #s is likely to be a comment in a hosts file.
        if ( len > 3 ) { return; }
        if ( len !== 1 ) {
            // If a space immediately follows 2 #s, assume a comment.
            if ( len === 2 ) {
                if ( from+3 === end || hasBits(this.slices[from+3], BITSpace) ) {
                    return;
                }
            } else /* len === 3 */ {
                this.splitSlot(from, 2);
                end = this.rightSpaceSpan.i;
            }
            this.optionsSpan.i = this.leftSpaceSpan.i + this.leftSpaceSpan.len;
            this.optionsSpan.len = from - this.optionsSpan.i;
            this.optionsAnchorSpan.i = from;
            this.optionsAnchorSpan.len = 3;
            this.patternSpan.i = from + 3;
            this.patternSpan.len = this.rightSpaceSpan.i - this.patternSpan.i;
            this.category = CATStaticExtFilter;
            this.analyzeExtPattern();
            return;
        }
        let flavorBits = 0;
        let to = from + 3;
        if ( to === end ) { return; }
        // #@...
        //  ^
        if ( hasBits(this.slices[to], BITAt) ) {
            if ( this.slices[to+2] !== 1 ) { return; }
            flavorBits |= BITFlavorException;
            to += 3; if ( to === end ) { return; }
        }
        // #$...
        //  ^
        if ( hasBits(this.slices[to], BITDollar) ) {
            if ( this.slices[to+2] !== 1 ) { return; }
            flavorBits |= BITFlavorExtStyle;
            to += 3; if ( to === end ) { return; }
            // #$?...
            //   ^
            if ( hasBits(this.slices[to], BITQuestion) ) {
                if ( this.slices[to+2] !== 1 ) { return; }
                flavorBits |= BITFlavorExtStrong;
                to += 3; if ( to === end ) { return; }
            }
        }
        // #[%?]...
        //   ^^
        else if ( hasBits(this.slices[to], BITPercent | BITQuestion) ) {
            if ( this.slices[to+2] !== 1 ) { return; }
            flavorBits |= hasBits(this.slices[to], BITQuestion)
                ? BITFlavorExtStrong
                : BITFlavorUnsupported;
            to += 3; if ( to === end ) { return; }
        }
        // ##...
        //  ^
        if ( hasNoBits(this.slices[to], BITHash) ) { return; }
        if ( this.slices[to+2] > 1 ) {
            this.splitSlot(to, 1);
        }
        to += 3;
        this.optionsSpan.i = this.leftSpaceSpan.i + this.leftSpaceSpan.len;
        this.optionsSpan.len = from - this.optionsSpan.i;
        this.optionsAnchorSpan.i = from;
        this.optionsAnchorSpan.len = to - this.optionsAnchorSpan.i;
        this.patternSpan.i = to;
        this.patternSpan.len = this.rightSpaceSpan.i - to;
        this.flavorBits = flavorBits;
        this.category = CATStaticExtFilter;
        this.analyzeExtPattern();
    }

    analyzeExtPattern() {
        this.result.exception = this.isException();
        this.result.compiled = undefined;
        this.result.pseudoclass = false;

        let selector = this.strFromSpan(this.patternSpan);
        if ( selector === '' ) {
            this.flavorBits |= BITFlavorUnsupported;
            this.result.raw = '';
            return;
        }
        const { i } = this.patternSpan;
        // ##+js(...)
        if (
            hasBits(this.slices[i], BITPlus) &&
            selector.startsWith('+js(') && selector.endsWith(')')
        ) {
            this.flavorBits |= BITFlavorExtScriptlet;
            this.result.raw = selector;
            this.result.compiled = selector.slice(4, -1);
            return;
        }
        // ##^...
        if ( hasBits(this.slices[i], BITCaret) ) {
            this.flavorBits |= BITFlavorExtHTML;
            selector = selector.slice(1);
        }
        // ##...
        else {
            this.flavorBits |= BITFlavorExtCosmetic;
        }
        this.result.raw = selector;
        if ( this.selectorCompiler.compile(selector, this.result) === false ) {
            this.flavorBits |= BITFlavorUnsupported;
        }
    }

    // Use in syntax highlighting contexts
    analyzeExtExtra() {
        if ( this.hasOptions() ) {
            const { i, len } = this.optionsSpan;
            this.analyzeDomainList(i, i + len, BITComma, 0b1110);
        }
        if ( hasBits(this.flavorBits, BITFlavorUnsupported) ) {
            this.markSpan(this.patternSpan, BITError);
        }
    }

    // Static network filters are all of the form:
    //
    // 1. exception declarator (optional): `@@`
    // 2. left-hand pattern anchor (optional): `||` or `|`
    // 3. pattern: a valid pattern, one of
    //       a regex, starting and ending with `/`
    //       a sequence of characters with optional wildcard characters
    //          wildcard `*` : regex equivalent => /./
    //          wildcard `^` : regex equivalent => /[^%.0-9a-z_-]|$/
    // 4. right-hand anchor (optional): `|`
    // 5. options declarator (optional): `$`
    //       options: one or more options
    // 6. inline comment (optional): ` #`
    //
    // When a valid static filter is found:
    //     exceptionSpan: first slice of exception declarator
    //     patternLeftAnchorSpan: first slice to left-hand pattern anchor
    //     patternSpan: all slices belonging to pattern
    //     patternRightAnchorSpan: first slice to right-hand pattern anchor
    //     optionsAnchorSpan: first slice to options anchor
    //     optionsSpan: first slice to options
    analyzeNet() {
        let islice = this.leftSpaceSpan.len;

        // Assume no exception
        this.exceptionSpan.i = this.leftSpaceSpan.len;
        // Exception?
        if (
            islice < this.commentSpan.i &&
            hasBits(this.slices[islice], BITAt)
        ) {
            const len = this.slices[islice+2];
            // @@@*, ...  =>  @@, @*, ...
            if ( len >= 2 ) {
                if ( len > 2 ) {
                    this.splitSlot(islice, 2);
                }
                this.exceptionSpan.len = 3;
                islice += 3;
                this.flavorBits |= BITFlavorException;
            }
        }

        // Assume no options
        this.optionsAnchorSpan.i = this.optionsSpan.i =  this.commentSpan.i;

        // Assume all is part of pattern
        this.patternSpan.i = islice;
        this.patternSpan.len = this.optionsAnchorSpan.i - islice;

        let patternStartIsRegex =
            islice < this.optionsAnchorSpan.i &&
            hasBits(this.slices[islice], BITSlash);
        let patternIsRegex = patternStartIsRegex;
        if ( patternStartIsRegex ) {
            const { i, len } = this.patternSpan;
            patternIsRegex = (
                len === 3 && this.slices[i+2] > 2 ||
                len > 3 && hasBits(this.slices[i+len-3], BITSlash)
            );
        }

        // If the pattern is not a regex, there might be options.
        if ( patternIsRegex === false ) {
            let optionsBits = 0;
            let i = this.optionsAnchorSpan.i;
            for (;;) {
                i -= 3;
                if ( i < islice ) { break; }
                const bits = this.slices[i];
                if ( hasBits(bits, BITDollar) ) { break; }
                optionsBits |= bits;
            }
            if ( i >= islice ) {
                const len = this.slices[i+2];
                if ( len > 1 ) {
                    // https://github.com/gorhill/uBlock/issues/952
                    //   AdGuard-specific `$$` filters => unsupported.
                    if ( this.findFirstOdd(0, BITHostname | BITComma | BITAsterisk) === i ) {
                        this.flavorBits |= BITFlavorError;
                        if ( this.interactive ) {
                            this.markSlices(i, i+3, BITError);
                        }
                    } else {
                        this.splitSlot(i, len - 1);
                        i += 3;
                    }
                }
                this.patternSpan.len = i - this.patternSpan.i;
                this.optionsAnchorSpan.i = i;
                this.optionsAnchorSpan.len = 3;
                i += 3;
                this.optionsSpan.i = i;
                this.optionsSpan.len = this.commentSpan.i - i;
                this.optionsBits = optionsBits;
                if ( patternStartIsRegex ) {
                    const { i, len } = this.patternSpan;
                    patternIsRegex = (
                        len === 3 && this.slices[i+2] > 2 ||
                        len > 3 && hasBits(this.slices[i+len-3], BITSlash)
                    );
                }
            }
        }

        // If the pattern is a regex, remember this.
        if ( patternIsRegex ) {
            this.flavorBits |= BITFlavorNetRegex;
        }

        // Refine by processing pattern anchors.
        //
        // Assume no anchors.
        this.patternLeftAnchorSpan.i = this.patternSpan.i;
        this.patternRightAnchorSpan.i = this.optionsAnchorSpan.i;
        // Not a regex, there might be anchors.
        if ( patternIsRegex === false ) {
            // Left anchor?
            //   `|`: anchor to start of URL
            //   `||`: anchor to left of a hostname label
            if (
                this.patternSpan.len !== 0 &&
                hasBits(this.slices[this.patternSpan.i], BITPipe)
            ) {
                this.patternLeftAnchorSpan.len = 3;
                const len = this.slices[this.patternSpan.i+2];
                // |||*, ...  =>  ||, |*, ...
                if ( len > 2 ) {
                    this.splitSlot(this.patternSpan.i, 2);
                } else {
                    this.patternSpan.len -= 3;
                }
                this.patternSpan.i += 3;
                this.flavorBits |= len === 1
                    ? BITFlavorNetLeftURLAnchor
                    : BITFlavorNetLeftHnAnchor;
            }
            // Right anchor?
            //   `|`: anchor to end of URL
            //   `^`: anchor to end of hostname, when other conditions are
            //        fulfilled:
            //          the pattern is hostname-anchored on the left
            //          the pattern is made only of hostname characters
            if ( this.patternSpan.len !== 0 ) {
                const lastPatternSlice = this.patternSpan.len > 3
                    ? this.patternRightAnchorSpan.i - 3
                    : this.patternSpan.i;
                const bits = this.slices[lastPatternSlice];
                if ( (bits & BITPipe) !== 0 ) {
                    this.patternRightAnchorSpan.i = lastPatternSlice;
                    this.patternRightAnchorSpan.len = 3;
                    const len = this.slices[this.patternRightAnchorSpan.i+2];
                    // ..., ||*  =>  ..., |*, |
                    if ( len > 1 ) {
                        this.splitSlot(this.patternRightAnchorSpan.i, len - 1);
                        this.patternRightAnchorSpan.i += 3;
                    } else {
                        this.patternSpan.len -= 3;
                    }
                    this.flavorBits |= BITFlavorNetRightURLAnchor;
                } else if (
                    hasBits(bits, BITCaret) &&
                    this.slices[lastPatternSlice+2] === 1 &&
                    hasBits(this.flavorBits, BITFlavorNetLeftHnAnchor) &&
                    this.skipUntilNot(
                        this.patternSpan.i,
                        lastPatternSlice,
                        BITHostname
                    ) === lastPatternSlice
                ) {
                    this.patternRightAnchorSpan.i = lastPatternSlice;
                    this.patternRightAnchorSpan.len = 3;
                    this.patternSpan.len -= 3;
                    this.flavorBits |= BITFlavorNetRightHnAnchor;
                }
            }
        }

        // Collate useful pattern bits information for further use.
        //
        // https://github.com/gorhill/httpswitchboard/issues/15
        //   When parsing a hosts file, ensure localhost et al. don't end up
        //   in the pattern. To accomplish this we establish the rule that
        //   if a pattern contains a space character, the pattern will be only
        //   the part following the space character.
        // https://github.com/uBlockOrigin/uBlock-issues/issues/1118
        //   Patterns with more than one space are dubious.
        {
            const { i, len } = this.patternSpan;
            const noOptionsAnchor = this.optionsAnchorSpan.len === 0;
            let j = len;
            for (;;) {
                if ( j === 0 ) { break; }
                j -= 3;
                const bits = this.slices[i+j];
                if ( noOptionsAnchor && hasBits(bits, BITSpace) ) { break; }
                this.patternBits |= bits;
            }
            if ( j !== 0 ) {
                const sink = this.strFromSlices(this.patternSpan.i, j - 3);
                if ( this.reHostsSink.test(sink) ) {
                    this.patternSpan.i += j + 3;
                    this.patternSpan.len -= j + 3;
                    if ( this.interactive ) {
                        this.markSlices(0, this.patternSpan.i, BITIgnore);
                    }
                    const source = this.getNetPattern();
                    if ( this.reIsLocalhostRedirect.test(source) ) {
                        this.flavorBits |= BITFlavorIgnore;
                    } else if ( this.reHostsSource.test(source) === false ) {
                        this.patternBits |= BITError;
                    }
                } else {
                    this.patternBits |= BITError;
                }
                if ( hasBits(this.patternBits, BITError) ) {
                    this.markSpan(this.patternSpan, BITError);
                }
            }
        }

        // Pointless wildcards and anchoring:
        // - Eliminate leading wildcard not followed by a pattern token slice
        // - Eliminate trailing wildcard not preceded by a pattern token slice
        // - Eliminate pattern anchoring when irrelevant
        //
        // Leading wildcard history:
        // https://github.com/gorhill/uBlock/issues/1669#issuecomment-224822448
        //   Remove pointless leading *.
        // https://github.com/gorhill/uBlock/issues/3034
        //   We can remove anchoring if we need to match all at the start.
        //
        // Trailing wildcard history:
        // https://github.com/gorhill/uBlock/issues/3034
        //   We can remove anchoring if we need to match all at the end.
        {
            let { i, len } = this.patternSpan;
            // Pointless leading wildcard
            if (
                len > 3 &&
                hasBits(this.slices[i], BITAsterisk) &&
                hasNoBits(this.slices[i+3], BITPatternToken)
            ) {
                this.slices[i] |= BITIgnore;
                i += 3; len -= 3;
                this.patternSpan.i = i;
                this.patternSpan.len = len;
                // We can ignore left-hand pattern anchor
                if ( this.patternLeftAnchorSpan.len !== 0 ) {
                    this.slices[this.patternLeftAnchorSpan.i] |= BITIgnore;
                    this.flavorBits &= ~BITFlavorNetLeftAnchor;
                }
            }
            // Pointless trailing wildcard
            if (
                len > 3 &&
                hasBits(this.slices[i+len-3], BITAsterisk) &&
                hasNoBits(this.slices[i+len-6], BITPatternToken)
            ) {
                // Ignore only if the pattern would not end up looking like
                // a regex.
                if (
                    hasNoBits(this.slices[i], BITSlash) ||
                    hasNoBits(this.slices[i+len-6], BITSlash)
                ) {
                    this.slices[i+len-3] |= BITIgnore;
                }
                len -= 3;
                this.patternSpan.len = len;
                // We can ignore right-hand pattern anchor
                if ( this.patternRightAnchorSpan.len !== 0 ) {
                    this.slices[this.patternRightAnchorSpan.i] |= BITIgnore;
                    this.flavorBits &= ~BITFlavorNetRightAnchor;
                }
            }
            // Pointless left-hand pattern anchoring
            if (
                (
                    len === 0 ||
                    len !== 0 && hasBits(this.slices[i], BITAsterisk)
                ) &&
                hasBits(this.flavorBits, BITFlavorNetLeftAnchor)
            ) {
                this.slices[this.patternLeftAnchorSpan.i] |= BITIgnore;
                this.flavorBits &= ~BITFlavorNetLeftAnchor;
            }
            // Pointless right-hand pattern anchoring
            if (
                (
                    len === 0 ||
                    len !== 0 && hasBits(this.slices[i+len-3], BITAsterisk)
                ) &&
                hasBits(this.flavorBits, BITFlavorNetRightAnchor)
            ) {
                this.slices[this.patternRightAnchorSpan.i] |= BITIgnore;
                this.flavorBits &= ~BITFlavorNetRightAnchor;
            }
        }

        this.category = CATStaticNetFilter;
    }

    analyzeNetExtra() {
        // Validate regex
        if ( this.patternIsRegex() ) {
            try {
                void new RegExp(this.getNetPattern());
            }
            catch (ex) {
                this.markSpan(this.patternSpan, BITError);
            }
        } else if (
            this.patternIsDubious() === false &&
            this.toASCII(true) === false
        ) {
            this.markSlices(
                this.patternLeftAnchorSpan.i,
                this.optionsAnchorSpan.i,
                BITError
            );
        }
        this.netOptionsIterator.init();
    }

    analyzeDomainList(from, to, bitSeparator, optionBits) {
        if ( from >= to ) { return; }
        let beg = from;
        // Dangling leading separator?
        if ( hasBits(this.slices[beg], bitSeparator) ) {
            this.markSlices(beg, beg + 3, BITError);
            beg += 3;
        }
        while ( beg < to ) {
            let end = this.skipUntil(beg, to, bitSeparator);
            if ( end < to && this.slices[end+2] !== 1 ) {
                this.markSlices(end, end + 3, BITError);
            }
            if ( this.analyzeDomain(beg, end, optionBits) === false ) {
                this.markSlices(beg, end, BITError);
            }
            beg = end + 3;
        }
        // Dangling trailing separator?
        if ( hasBits(this.slices[to-3], bitSeparator) ) {
            this.markSlices(to - 3, to, BITError);
        }
    }

    analyzeDomain(from, to, modeBits) {
        if ( to === from ) { return false; }
        return this.normalizeHostnameValue(
            this.strFromSlices(from, to - 3),
            modeBits
        ) !== undefined;
    }

    // Ultimately, let the browser API do the hostname normalization, after
    // making some other trivial checks.
    //
    // modeBits:
    //   0: can use wildcard at any position
    //   1: can use entity-based hostnames
    //   2: can use single wildcard
    //   3: can be negated
    normalizeHostnameValue(s, modeBits = 0b0000) {
        const not = s.charCodeAt(0) === 0x7E /* '~' */;
        if ( not && (modeBits & 0b1000) === 0 ) { return; }
        let hn = not === false ? s : s.slice(1);
        if ( this.rePlainHostname.test(hn) ) { return s; }
        const hasWildcard = hn.lastIndexOf('*') !== -1;
        if ( hasWildcard ) {
            if ( modeBits === 0 ) { return; }
            if ( hn.length === 1 ) {
                if ( not || (modeBits & 0b0100) === 0 ) { return; }
                return s;
            }
            if ( (modeBits & 0b0010) !== 0 ) {
                if ( this.rePlainEntity.test(hn) ) { return s; }
                if ( this.reEntity.test(hn) === false ) { return; }
            } else if ( (modeBits & 0b0001) === 0 ) {
                return;
            }
            hn = hn.replace(/\*/g, '__asterisk__');
        }
        this.punycoder.hostname = '_';
        try {
            this.punycoder.hostname = hn;
            hn = this.punycoder.hostname;
        } catch (_) {
            return;
        }
        if ( hn === '_' || hn === '' ) { return; }
        if ( hasWildcard ) {
            hn = this.punycoder.hostname.replace(/__asterisk__/g, '*');
        }
        if (
            (modeBits & 0b0001) === 0 && (
                hn.charCodeAt(0) === 0x2E /* '.' */ ||
                hn.charCodeAt(hn.length - 1) === 0x2E /* '.' */
            )
        ) {
            return;
        }
        return not ? '~' + hn : hn;
    }

    slice(raw) {
        this.reset();
        this.raw = raw;
        const rawEnd = raw.length;
        if ( rawEnd === 0 ) { return; }
        // All unicode characters are allowed in hostname
        const unicodeBits = BITUnicode | BITAlpha;
        // Create raw slices
        const slices = this.slices;
        let ptr = this.sliceWritePtr;
        let c = raw.charCodeAt(0);
        let aBits = c < 0x80 ? charDescBits[c] : unicodeBits;
        slices[ptr+0] = aBits;
        slices[ptr+1] = 0;
        ptr += 2;
        let allBits = aBits;
        let i = 0, j = 1;
        while ( j < rawEnd ) {
            c = raw.charCodeAt(j);
            const bBits = c < 0x80 ? charDescBits[c] : unicodeBits;
            if ( bBits !== aBits ) {
                slices[ptr+0] = j - i;
                slices[ptr+1] = bBits;
                slices[ptr+2] = j;
                ptr += 3;
                allBits |= bBits;
                aBits = bBits;
                i = j;
            }
            j += 1;
        }
        slices[ptr+0] = j - i;
        ptr += 1;
        // End-of-line slice
        this.eolSpan.i = ptr;
        slices[ptr+0] = 0;
        slices[ptr+1] = rawEnd;
        slices[ptr+2] = 0;
        ptr += 3;
        // Trim left
        if ( (slices[0] & BITSpace) !== 0 ) {
            this.leftSpaceSpan.len = 3;
        } else {
            this.leftSpaceSpan.len = 0;
        }
        // Trim right
        const lastSlice = this.eolSpan.i - 3;
        if (
            (lastSlice > this.leftSpaceSpan.i) &&
            (slices[lastSlice] & BITSpace) !== 0
        ) {
            this.rightSpaceSpan.i = lastSlice;
            this.rightSpaceSpan.len = 3;
        } else {
            this.rightSpaceSpan.i = this.eolSpan.i;
            this.rightSpaceSpan.len = 0;
        }
        // Quit cleanly
        this.sliceWritePtr = ptr;
        this.allBits = allBits;
    }

    splitSlot(slot, len) {
        this.sliceWritePtr += 3;
        if ( this.sliceWritePtr > this.slices.length ) {
            this.slices.push(0, 0, 0);
        }
        this.slices.copyWithin(slot + 3, slot, this.sliceWritePtr - 3);
        this.slices[slot+3+1] = this.slices[slot+1] + len;
        this.slices[slot+3+2] = this.slices[slot+2] - len;
        this.slices[slot+2] = len;
        for ( const span of this.spans ) {
            if ( span.i > slot ) {
                span.i += 3;
            }
        }
    }

    markSlices(beg, end, bits) {
        while ( beg < end ) {
            this.slices[beg] |= bits;
            beg += 3;
        }
    }

    markSpan(span, bits) {
        const { i, len } = span;
        this.markSlices(i, i + len, bits);
    }

    unmarkSlices(beg, end, bits) {
        while ( beg < end ) {
            this.slices[beg] &= ~bits;
            beg += 3;
        }
    }

    findFirstMatch(from, bits) {
        let to = from;
        while ( to < this.sliceWritePtr ) {
            if ( (this.slices[to] & bits) !== 0 ) { return to; }
            to += 3;
        }
        return -1;
    }

    findFirstOdd(from, bits) {
        let to = from;
        while ( to < this.sliceWritePtr ) {
            if ( (this.slices[to] & bits) === 0 ) { return to; }
            to += 3;
        }
        return -1;
    }

    skipUntil(from, to, bits) {
        let i = from;
        while ( i < to ) {
            if ( (this.slices[i] & bits) !== 0 ) { break; }
            i += 3;
        }
        return i;
    }

    skipUntilNot(from, to, bits) {
        let i = from;
        while ( i < to ) {
            if ( (this.slices[i] & bits) === 0 ) { break; }
            i += 3;
        }
        return i;
    }

    strFromSlices(from, to) {
        return this.raw.slice(
            this.slices[from+1],
            this.slices[to+1] + this.slices[to+2]
        );
    }

    strFromSpan(span) {
        if ( span.len === 0 ) { return ''; }
        const beg = span.i;
        return this.strFromSlices(beg, beg + span.len - 3);
    }

    isBlank() {
        return this.allBits === BITSpace;
    }

    hasOptions() {
        return this.optionsSpan.len !== 0;
    }

    getPattern() {
        if ( this.pattern !== '' ) { return this.pattern; }
        const { i, len } = this.patternSpan;
        if ( len === 0 ) { return ''; }
        let beg = this.slices[i+1];
        let end = this.slices[i+len+1];
        this.pattern = this.raw.slice(beg, end);
        return this.pattern;
    }

    getNetPattern() {
        if ( this.pattern !== '' ) { return this.pattern; }
        const { i, len } = this.patternSpan;
        if ( len === 0 ) { return ''; }
        let beg = this.slices[i+1];
        let end = this.slices[i+len+1];
        if ( hasBits(this.flavorBits, BITFlavorNetRegex) ) {
            beg += 1; end -= 1;
        }
        this.pattern = this.raw.slice(beg, end);
        return this.pattern;
    }

    // https://github.com/chrisaljoudi/uBlock/issues/1096
    // https://github.com/ryanbr/fanboy-adblock/issues/1384
    // Examples of dubious filter content:
    //   - Spaces characters
    //   - Single character with no options
    //   - Wildcard(s) with no options
    //   - Zero-length pattern with no options
    patternIsDubious() {
        if ( hasBits(this.patternBits, BITError) ) { return true; }
        if ( hasBits(this.patternBits, BITSpace) ) {
            if ( this.interactive ) {
                this.markSpan(this.patternSpan, BITError);
            }
            return true;
        }
        if ( this.patternSpan.len > 3 || this.optionsSpan.len !== 0 ) {
            return false;
        }
        if (
            this.patternSpan.len === 3 &&
            this.slices[this.patternSpan.i+2] !== 1 &&
            hasNoBits(this.patternBits, BITAsterisk)
        ) {
            return false;
        }
        if ( this.interactive === false ) { return true; }
        let l, r;
        if ( this.patternSpan.len !== 0 ) {
            l = this.patternSpan.i;
            r = this.optionsAnchorSpan.i;
        } else {
            l = this.patternLeftAnchorSpan.i;
            r = this.patternLeftAnchorSpan.len !== 0
                ? this.optionsAnchorSpan.i
                : this.optionsSpan.i;
        }
        this.markSlices(l, r, BITError);
        return true;
    }

    patternIsMatchAll() {
        const { len } = this.patternSpan;
        return len === 0 ||
               len === 3 && hasBits(this.patternBits, BITAsterisk);
    }

    patternIsPlainHostname() {
        if (
            hasBits(this.patternBits, ~BITHostname) || (
                hasBits(this.flavorBits, BITFlavorNetAnchor) &&
                hasNotAllBits(this.flavorBits, BITFlavorNetHnAnchor)
            )
        ) {
            return false;
        }
        const { i, len } = this.patternSpan;
        return hasBits(this.slices[i], BITAlphaNum) &&
               hasBits(this.slices[i+len-3], BITAlphaNum);
    }

    patternIsLeftHostnameAnchored() {
        return hasBits(this.flavorBits, BITFlavorNetLeftHnAnchor);
    }

    patternIsRightHostnameAnchored() {
        return hasBits(this.flavorBits, BITFlavorNetRightHnAnchor);
    }

    patternIsLeftAnchored() {
        return hasBits(this.flavorBits, BITFlavorNetLeftURLAnchor);
    }

    patternIsRightAnchored() {
        return hasBits(this.flavorBits, BITFlavorNetRightURLAnchor);
    }

    patternIsRegex() {
        return (this.flavorBits & BITFlavorNetRegex) !== 0;
    }

    patternHasWildcard() {
        return hasBits(this.patternBits, BITAsterisk);
    }

    patternHasCaret() {
        return hasBits(this.patternBits, BITCaret);
    }

    patternHasUnicode() {
        return hasBits(this.patternBits, BITUnicode);
    }

    patternHasUppercase() {
        return hasBits(this.patternBits, BITUppercase);
    }

    patternToLowercase() {
        const hasUpper = this.patternHasUppercase();
        if ( hasUpper === false && this.pattern !== '' ) {
            return this.pattern;
        }
        const { i, len } = this.patternSpan;
        if ( len === 0 ) { return ''; }
        const beg = this.slices[i+1];
        const end = this.slices[i+len+1];
        this.pattern = this.pattern || this.raw.slice(beg, end);
        if ( hasUpper === false ) { return this.pattern; }
        this.pattern = this.pattern.toLowerCase();
        this.raw = this.raw.slice(0, beg) +
                   this.pattern +
                   this.raw.slice(end);
        this.unmarkSlices(i, i + len, BITUppercase);
        this.patternBits &= ~BITUppercase;
        return this.pattern;
    }

    patternHasSpace() {
        return hasBits(this.flavorBits, BITFlavorNetSpaceInPattern);
    }

    patternHasLeadingWildcard() {
        if ( hasBits(this.patternBits, BITAsterisk) === false ) {
            return false;
        }
        const { i, len } = this.patternSpan;
        return len !== 0 && hasBits(this.slices[i], BITAsterisk);
    }

    patternHasTrailingWildcard() {
        if ( hasBits(this.patternBits, BITAsterisk) === false ) {
            return false;
        }
        const { i, len } = this.patternSpan;
        return len !== 0 && hasBits(this.slices[i+len-1], BITAsterisk);
    }

    optionHasUnicode() {
        return hasBits(this.optionsBits, BITUnicode);
    }

    netOptions() {
        return this.netOptionsIterator;
    }

    extOptions() {
        return this.extOptionsIterator;
    }

    patternTokens() {
        if ( this.category === CATStaticNetFilter ) {
            return this.patternTokenIterator;
        }
        return [];
    }

    setMaxTokenLength(len) {
        this.maxTokenLength = len;
    }

    hasUnicode() {
        return hasBits(this.allBits, BITUnicode);
    }

    toLowerCase() {
        if ( hasBits(this.allBits, BITUppercase) ) {
            this.raw = this.raw.toLowerCase();
        }
        return this.raw;
    }

    // https://github.com/uBlockOrigin/uBlock-issues/issues/1118#issuecomment-650730158
    //   Be ready to deal with non-punycode-able Unicode characters.
    // https://github.com/uBlockOrigin/uBlock-issues/issues/772
    //   Encode Unicode characters beyond the hostname part.
    // Prepend with '*' character to prevent the browser API from refusing to
    // punycode -- this occurs when the extracted label starts with a dash.
    toASCII(dryrun = false) {
        if ( this.patternHasUnicode() === false ) { return true; }
        const { i, len } = this.patternSpan;
        if ( len === 0 ) { return true; }
        const patternIsRegex = this.patternIsRegex();
        let pattern = this.getNetPattern();
        // Punycode hostname part of the pattern.
        if ( patternIsRegex === false ) {
            const match = this.reHostname.exec(pattern);
            if ( match !== null ) {
                const hn = match[0].replace(this.reHostnameLabel, s => {
                    if ( this.reUnicodeChar.test(s) === false ) { return s; }
                    if ( s.charCodeAt(0) === 0x2D /* '-' */ ) { s = '*' + s; }
                    return this.normalizeHostnameValue(s, 0b0001) || s;
                });
                pattern = hn + pattern.slice(match.index + match[0].length);
            }
        }
        // Percent-encode remaining Unicode characters.
        if ( this.reUnicodeChar.test(pattern) ) {
            try {
                pattern = pattern.replace(
                    this.reUnicodeChars,
                    s => encodeURIComponent(s)
                );
            } catch (ex) {
                return false;
            }
        }
        if ( dryrun ) { return true; }
        if ( patternIsRegex ) {
            pattern = `/${pattern}/`;
        }
        const beg = this.slices[i+1];
        const end = this.slices[i+len+1];
        const raw = this.raw.slice(0, beg) + pattern + this.raw.slice(end);
        this.analyze(raw);
        return true;
    }

    hasFlavor(bits) {
        return hasBits(this.flavorBits, bits);
    }

    isException() {
        return hasBits(this.flavorBits, BITFlavorException);
    }

    shouldIgnore() {
        return hasBits(this.flavorBits, BITFlavorIgnore);
    }

    hasError() {
        return hasBits(this.flavorBits, BITFlavorError);
    }

    shouldDiscard() {
        return hasBits(
            this.flavorBits,
            BITFlavorError | BITFlavorUnsupported | BITFlavorIgnore
        );
    }
};

/******************************************************************************/

// https://github.com/chrisaljoudi/uBlock/issues/1004
//   Detect and report invalid CSS selectors.

// Discard new ABP's `-abp-properties` directive until it is
// implemented (if ever). Unlikely, see:
// https://github.com/gorhill/uBlock/issues/1752

// https://github.com/gorhill/uBlock/issues/2624
//   Convert Adguard's `-ext-has='...'` into uBO's `:has(...)`.

// https://github.com/uBlockOrigin/uBlock-issues/issues/89
//   Do not discard unknown pseudo-elements.

Parser.prototype.SelectorCompiler = class {
    constructor(parser) {
        this.parser = parser;
        this.reExtendedSyntax = /\[-(?:abp|ext)-[a-z-]+=(['"])(?:.+?)(?:\1)\]/;
        this.reExtendedSyntaxParser = /\[-(?:abp|ext)-([a-z-]+)=(['"])(.+?)\2\]/;
        this.reParseRegexLiteral = /^\/(.+)\/([imu]+)?$/;
        this.normalizedExtendedSyntaxOperators = new Map([
            [ 'contains', ':has-text' ],
            [ 'has', ':has' ],
            [ 'matches-css', ':matches-css' ],
            [ 'matches-css-after', ':matches-css-after' ],
            [ 'matches-css-before', ':matches-css-before' ],
        ]);
        this.reSimpleSelector = /^[#.][A-Za-z_][\w-]*$/;
        this.div = document.createElement('div');
        this.rePseudoElement = /:(?::?after|:?before|:-?[a-z][a-z-]*[a-z])$/;
        this.reProceduralOperator = new RegExp([
            '^(?:',
                Array.from(parser.proceduralOperatorTokens.keys()).join('|'),
            ')\\('
        ].join(''));
        this.reEatBackslashes = /\\([()])/g;
        this.reEscapeRegex = /[.*+?^${}()|[\]\\]/g;
        this.reNeedScope = /^\s*>/;
        this.reIsDanglingSelector = /[+>~\s]\s*$/;
        this.reIsSiblingSelector = /^\s*[+~]/;
        this.regexToRawValue = new Map();
        // https://github.com/gorhill/uBlock/issues/2793
        this.normalizedOperators = new Map([
            [ ':-abp-contains', ':has-text' ],
            [ ':-abp-has', ':has' ],
            [ ':contains', ':has-text' ],
            [ ':nth-ancestor', ':upward' ],
            [ ':watch-attrs', ':watch-attr' ],
        ]);
        this.actionOperators = new Set([
            ':remove',
            ':style',
        ]);
    }

    compile(raw, out) {
        // https://github.com/gorhill/uBlock/issues/952
        //   Find out whether we are dealing with an Adguard-specific cosmetic
        //   filter, and if so, translate it if supported, or discard it if not
        //   supported.
        //   We have an Adguard/ABP cosmetic filter if and only if the
        //   character is `$`, `%` or `?`, otherwise it's not a cosmetic
        //   filter.
        // Adguard's style injection: translate to uBO's format.
        if ( hasBits(this.parser.flavorBits, BITFlavorExtStyle) ) {
            raw = this.translateAdguardCSSInjectionFilter(raw);
            if ( raw === '' ) { return false; }
            this.parser.flavorBits &= ~BITFlavorExtStyle;
            out.raw = raw;
        }

        let extendedSyntax = false;
        const selectorType = this.cssSelectorType(raw);
        if ( selectorType !== 0 ) {
            extendedSyntax = this.reExtendedSyntax.test(raw);
            if ( extendedSyntax === false ) {
                out.pseudoclass = selectorType === 3;
                out.compiled = raw;
                return true;
            }
        }

        // We  rarely reach this point -- majority of selectors are plain
        // CSS selectors.

        // Supported Adguard/ABP advanced selector syntax: will translate
        // into uBO's syntax before further processing.
        // Mind unsupported advanced selector syntax, such as ABP's
        // `-abp-properties`.
        // Note: extended selector syntax has been deprecated in ABP, in
        // favor of the procedural one (i.e. `:operator(...)`).
        // See https://issues.adblockplus.org/ticket/5287
        if ( extendedSyntax ) {
            let matches;
            while ( (matches = this.reExtendedSyntaxParser.exec(raw)) !== null ) {
                const operator = this.normalizedExtendedSyntaxOperators.get(matches[1]);
                if ( operator === undefined ) { return false; }
                raw = raw.slice(0, matches.index) +
                      operator + '(' + matches[3] + ')' +
                      raw.slice(matches.index + matches[0].length);
            }
            return this.compile(raw, out);
        }

        // Procedural selector?
        const compiled = this.compileProceduralSelector(raw);
        if ( compiled === undefined ) { return false; }

        if ( compiled.pseudo !== undefined ) {
            out.pseudoclass = compiled.pseudo;
        }

        out.compiled = JSON.stringify(compiled);
        return true;
    }

    translateAdguardCSSInjectionFilter(suffix) {
        const matches = /^(.*)\s*\{([^}]+)\}\s*$/.exec(suffix);
        if ( matches === null ) { return ''; }
        const selector = matches[1].trim();
        const style = matches[2].trim();
        // Special style directive `remove: true` is converted into a
        // `:remove()` operator.
        if ( /^\s*remove:\s*true[; ]*$/.test(style) ) {
            return `${selector}:remove()`;
        }
        // For some reasons, many of Adguard's plain cosmetic filters are
        // "disguised" as style-based cosmetic filters: convert such filters
        // to plain cosmetic filters.
        return /display\s*:\s*none\s*!important;?$/.test(style)
            ? selector
            : `${selector}:style(${style})`;
    }

    // Return value:
    //   0b00 (0) = not a valid CSS selector
    //   0b01 (1) = valid CSS selector, without pseudo-element
    //   0b11 (3) = valid CSS selector, with pseudo element
    //
    // Quick regex-based validation -- most cosmetic filters are of the
    // simple form and in such case a regex is much faster.
    // Keep in mind:
    //   https://github.com/gorhill/uBlock/issues/693
    //   https://github.com/gorhill/uBlock/issues/1955
    // https://github.com/gorhill/uBlock/issues/3111
    //   Workaround until https://bugzilla.mozilla.org/show_bug.cgi?id=1406817
    //   is fixed.
    cssSelectorType(s) {
        if ( this.reSimpleSelector.test(s) ) { return 1; }
        const pos = this.cssPseudoElement(s);
        if ( pos !== -1 ) {
            return this.cssSelectorType(s.slice(0, pos)) === 1 ? 3 : 0;
        }
        try {
            this.div.matches(`${s}, ${s}:not(#foo)`);
        } catch (ex) {
            return 0;
        }
        return 1;
    }

    cssPseudoElement(s) {
        if ( s.lastIndexOf(':') === -1 ) { return -1; }
        const match = this.rePseudoElement.exec(s);
        return match !== null ? match.index : -1;
    }

    compileProceduralSelector(raw) {
        const compiled = this.compileProcedural(raw, true);
        if ( compiled !== undefined ) {
            compiled.raw = this.decompileProcedural(compiled);
        }
        return compiled;
    }

    isBadRegex(s) {
        try {
            void new RegExp(s);
        } catch (ex) {
            this.isBadRegex.message = ex.toString();
            return true;
        }
        return false;
    }

    // When dealing with literal text, we must first eat _some_
    // backslash characters.
    compileText(s) {
        const match = this.reParseRegexLiteral.exec(s);
        let regexDetails;
        if ( match !== null ) {
            regexDetails = match[1];
            if ( this.isBadRegex(regexDetails) ) { return; }
            if ( match[2] ) {
                regexDetails = [ regexDetails, match[2] ];
            }
        } else {
            regexDetails = s.replace(this.reEatBackslashes, '$1')
                            .replace(this.reEscapeRegex, '\\$&');
            this.regexToRawValue.set(regexDetails, s);
        }
        return regexDetails;
    }

    compileCSSDeclaration(s) {
        const pos = s.indexOf(':');
        if ( pos === -1 ) { return; }
        const name = s.slice(0, pos).trim();
        const value = s.slice(pos + 1).trim();
        const match = this.reParseRegexLiteral.exec(value);
        let regexDetails;
        if ( match !== null ) {
            regexDetails = match[1];
            if ( this.isBadRegex(regexDetails) ) { return; }
            if ( match[2] ) {
                regexDetails = [ regexDetails, match[2] ];
            }
        } else {
            regexDetails = '^' + value.replace(this.reEscapeRegex, '\\$&') + '$';
            this.regexToRawValue.set(regexDetails, value);
        }
        return { name: name, value: regexDetails };
    }

    compileConditionalSelector(s) {
        // https://github.com/AdguardTeam/ExtendedCss/issues/31#issuecomment-302391277
        //   Prepend `:scope ` if needed.
        if ( this.reNeedScope.test(s) ) {
            s = `:scope ${s}`;
        }
        return this.compileProcedural(s);
    }

    compileInteger(s, min = 0, max = 0x7FFFFFFF) {
        if ( /^\d+$/.test(s) === false ) { return; }
        const n = parseInt(s, 10);
        if ( n < min || n >= max ) { return; }
        return n;
    }

    compileNotSelector(s) {
        // https://github.com/uBlockOrigin/uBlock-issues/issues/341#issuecomment-447603588
        //   Reject instances of :not() filters for which the argument is
        //   a valid CSS selector, otherwise we would be adversely
        //   changing the behavior of CSS4's :not().
        if ( this.cssSelectorType(s) === 0 ) {
            return this.compileConditionalSelector(s);
        }
    }

    compileUpwardArgument(s) {
        const i = this.compileInteger(s, 1, 256);
        if ( i !== undefined ) { return i; }
        if ( this.cssSelectorType(s) === 1 ) { return s; }
    }

    compileRemoveSelector(s) {
        if ( s === '' ) { return s; }
    }

    compileSpathExpression(s) {
        if ( this.cssSelectorType('*' + s) === 1 ) {
            return s;
        }
    }

    // https://github.com/uBlockOrigin/uBlock-issues/issues/668
    compileStyleProperties(s) {
        if ( /url\(|\\/i.test(s) ) { return; }
        this.div.style.cssText = s;
        if ( this.div.style.cssText === '' ) { return; }
        this.div.style.cssText = '';
        return s;
    }

    compileAttrList(s) {
        const attrs = s.split('\s*,\s*');
        const out = [];
        for ( const attr of attrs ) {
            if ( attr !== '' ) {
                out.push(attr);
            }
        }
        return out;
    }

    compileXpathExpression(s) {
        try {
            document.createExpression(s, null);
        } catch (e) {
            return;
        }
        return s;
    }

    // https://github.com/gorhill/uBlock/issues/2793#issuecomment-333269387
    //   Normalize (somewhat) the stringified version of procedural
    //   cosmetic filters -- this increase the likelihood of detecting
    //   duplicates given that uBO is able to understand syntax specific
    //   to other blockers.
    //   The normalized string version is what is reported in the logger,
    //   by design.
    decompileProcedural(compiled) {
        const tasks = compiled.tasks || [];
        const raw = [ compiled.selector ];
        for ( const task of tasks ) {
            let value;
            switch ( task[0] ) {
            case ':has':
            case ':if':
                raw.push(`:has(${this.decompileProcedural(task[1])})`);
                break;
            case ':has-text':
                if ( Array.isArray(task[1]) ) {
                    value = `/${task[1][0]}/${task[1][1]}`;
                } else {
                    value = this.regexToRawValue.get(task[1]);
                    if ( value === undefined ) {
                        value = `/${task[1]}/`;
                    }
                }
                raw.push(`:has-text(${value})`);
                break;
            case ':matches-css':
            case ':matches-css-after':
            case ':matches-css-before':
                if ( Array.isArray(task[1].value) ) {
                    value = `/${task[1].value[0]}/${task[1].value[1]}`;
                } else {
                    value = this.regexToRawValue.get(task[1].value);
                    if ( value === undefined ) {
                        value = `/${task[1].value}/`;
                    }
                }
                raw.push(`${task[0]}(${task[1].name}: ${value})`);
                break;
            case ':not':
            case ':if-not':
                raw.push(`:not(${this.decompileProcedural(task[1])})`);
                break;
            case ':spath':
                raw.push(task[1]);
                break;
            case ':min-text-length':
            case ':upward':
            case ':watch-attr':
            case ':xpath':
                raw.push(`${task[0]}(${task[1]})`);
                break;
            }
        }
        if ( Array.isArray(compiled.action) ) {
            const [ op, arg ] = compiled.action;
            raw.push(`${op}(${arg})`);
        }
        return raw.join('');
    }

    compileProcedural(raw, root = false) {
        if ( raw === '' ) { return; }

        const tasks = [];
        const n = raw.length;
        let prefix = '';
        let i = 0;
        let opPrefixBeg = 0;
        let action;

        // TODO: use slices instead of charCodeAt()
        for (;;) {
            let c, match;
            // Advance to next operator.
            while ( i < n ) {
                c = raw.charCodeAt(i++);
                if ( c === 0x3A /* ':' */ ) {
                    match = this.reProceduralOperator.exec(raw.slice(i));
                    if ( match !== null ) { break; }
                }
            }
            if ( i === n ) { break; }
            const opNameBeg = i - 1;
            const opNameEnd = i + match[0].length - 1;
            i += match[0].length;
            // Find end of argument: first balanced closing parenthesis.
            // Note: unbalanced parenthesis can be used in a regex literal
            // when they are escaped using `\`.
            // TODO: need to handle quoted parentheses.
            let pcnt = 1;
            while ( i < n ) {
                c = raw.charCodeAt(i++);
                if ( c === 0x5C /* '\\' */ ) {
                    if ( i < n ) { i += 1; }
                } else if ( c === 0x28 /* '(' */ ) {
                    pcnt +=1 ;
                } else if ( c === 0x29 /* ')' */ ) {
                    pcnt -= 1;
                    if ( pcnt === 0 ) { break; }
                }
            }
            // Unbalanced parenthesis? An unbalanced parenthesis is fine
            // as long as the last character is a closing parenthesis.
            if ( pcnt !== 0 && c !== 0x29 ) { return; }
            // https://github.com/uBlockOrigin/uBlock-issues/issues/341#issuecomment-447603588
            //   Maybe that one operator is a valid CSS selector and if so,
            //   then consider it to be part of the prefix.
            if ( this.cssSelectorType(raw.slice(opNameBeg, i)) === 1 ) {
                continue;
            }
            // Extract and remember operator details.
            let operator = raw.slice(opNameBeg, opNameEnd);
            operator = this.normalizedOperators.get(operator) || operator;
            // Action operator can only be used as trailing operator in the
            // root task list.
            // Per-operator arguments validation
            const args = this.compileArgument(
                operator,
                raw.slice(opNameEnd + 1, i - 1)
            );
            if ( args === undefined ) { return; }
            if ( opPrefixBeg === 0 ) {
                prefix = raw.slice(0, opNameBeg);
            } else if ( opNameBeg !== opPrefixBeg ) {
                if ( action !== undefined ) { return; }
                const spath = this.compileSpathExpression(
                    raw.slice(opPrefixBeg, opNameBeg)
                );
                if ( spath === undefined ) { return; }
                tasks.push([ ':spath', spath ]);
            }
            if ( action !== undefined ) { return; }
            const task = [ operator, args ];
            if ( this.actionOperators.has(operator) ) {
                if ( root === false ) { return; }
                action = task;
            } else {
                tasks.push(task);
            }
            opPrefixBeg = i;
            if ( i === n ) { break; }
        }

        // No task found: then we have a CSS selector.
        // At least one task found: nothing should be left to parse.
        if ( tasks.length === 0 && action === undefined ) {
            prefix = raw;
        } else if ( opPrefixBeg < n ) {
            if ( action !== undefined ) { return; }
            const spath = this.compileSpathExpression(raw.slice(opPrefixBeg));
            if ( spath === undefined ) { return; }
            tasks.push([ ':spath', spath ]);
        }

        // https://github.com/NanoAdblocker/NanoCore/issues/1#issuecomment-354394894
        // https://www.reddit.com/r/uBlockOrigin/comments/c6iem5/
        //   Convert sibling-selector prefix into :spath operator, but
        //   only if context is not the root.
        if ( prefix !== '' ) {
            if ( this.reIsDanglingSelector.test(prefix) && tasks.length !== 0 ) {
                prefix += ' *';
            }
            if ( this.cssSelectorType(prefix) === 0 ) {
                if (
                    root ||
                    this.reIsSiblingSelector.test(prefix) === false ||
                    this.compileSpathExpression(prefix) === undefined
                ) {
                    return;
                }
                tasks.unshift([ ':spath', prefix ]);
                prefix = '';
            }
        }

        const out = { selector: prefix };

        if ( tasks.length !== 0 ) {
            out.tasks = tasks;
        }

        // Expose action to take in root descriptor.
        if ( action !== undefined ) {
            out.action = action;
        }

        // Pseudo elements are valid only when used in a root task list AND
        // only when there are no procedural operators: pseudo elements can't
        // be querySelectorAll-ed.
        if ( prefix !== '' ) {
            const pos = this.cssPseudoElement(prefix);
            if ( pos !== -1 ) {
                if ( root === false || tasks.length !== 0 ) { return; }
                out.pseudo = pos;
            }
        }

        return out;
    }

    compileArgument(operator, args) {
        switch ( operator ) {
        case ':has':
            return this.compileConditionalSelector(args);
        case ':has-text':
            return this.compileText(args);
        case ':if':
            return this.compileConditionalSelector(args);
        case ':if-not':
            return this.compileConditionalSelector(args);
        case ':matches-css':
            return this.compileCSSDeclaration(args);
        case ':matches-css-after':
            return this.compileCSSDeclaration(args);
        case ':matches-css-before':
            return this.compileCSSDeclaration(args);
        case ':min-text-length':
            return this.compileInteger(args);
        case ':not':
            return this.compileNotSelector(args);
        case ':remove':
            return this.compileRemoveSelector(args);
        case ':spath':
            return this.compileSpathExpression(args);
        case ':style':
            return this.compileStyleProperties(args);
        case ':upward':
            return this.compileUpwardArgument(args);
        case ':watch-attr':
            return this.compileAttrList(args);
        case ':xpath':
            return this.compileXpathExpression(args);
        default:
            break;
        }
    }
};

Parser.prototype.proceduralOperatorTokens = new Map([
    [ '-abp-contains', 0b00 ],
    [ '-abp-has', 0b00, ],
    [ 'contains', 0b00, ],
    [ 'has', 0b01 ],
    [ 'has-text', 0b01 ],
    [ 'if', 0b00 ],
    [ 'if-not', 0b00 ],
    [ 'matches-css', 0b11 ],
    [ 'matches-css-after', 0b11 ],
    [ 'matches-css-before', 0b11 ],
    [ 'min-text-length', 0b01 ],
    [ 'not', 0b01 ],
    [ 'nth-ancestor', 0b00 ],
    [ 'remove', 0b11 ],
    [ 'style', 0b11 ],
    [ 'upward', 0b01 ],
    [ 'watch-attr', 0b11 ],
    [ 'watch-attrs', 0b00 ],
    [ 'xpath', 0b01 ],
]);

/******************************************************************************/

const hasNoBits = (v, bits) => (v & bits) === 0;
const hasBits = (v, bits) => (v & bits) !== 0;
const hasNotAllBits = (v, bits) => (v & bits) !== bits;
//const hasAllBits = (v, bits) => (v & bits) === bits;

/******************************************************************************/

const CATNone = 0;
const CATStaticExtFilter = 1;
const CATStaticNetFilter = 2;
const CATComment = 3;

const BITSpace          = 1 <<  0;
const BITGlyph          = 1 <<  1;
const BITExclamation    = 1 <<  2;
const BITHash           = 1 <<  3;
const BITDollar         = 1 <<  4;
const BITPercent        = 1 <<  5;
const BITParen          = 1 <<  6;
const BITAsterisk       = 1 <<  7;
const BITPlus           = 1 <<  8;
const BITComma          = 1 <<  9;
const BITDash           = 1 << 10;
const BITPeriod         = 1 << 11;
const BITSlash          = 1 << 12;
const BITNum            = 1 << 13;
const BITEqual          = 1 << 14;
const BITQuestion       = 1 << 15;
const BITAt             = 1 << 16;
const BITAlpha          = 1 << 17;
const BITUppercase      = 1 << 18;
const BITSquareBracket  = 1 << 19;
const BITBackslash      = 1 << 20;
const BITCaret          = 1 << 21;
const BITUnderscore     = 1 << 22;
const BITBrace          = 1 << 23;
const BITPipe           = 1 << 24;
const BITTilde          = 1 << 25;
const BITOpening        = 1 << 27;
const BITClosing        = 1 << 28;
const BITUnicode        = 1 << 29;
// TODO: separate from character bits into a new slice slot.
const BITIgnore         = 1 << 30;
const BITError          = 1 << 31;

const BITAll            = 0xFFFFFFFF;
const BITAlphaNum       = BITNum | BITAlpha;
const BITHostname       = BITNum | BITAlpha | BITUppercase | BITDash | BITPeriod | BITUnderscore | BITUnicode;
const BITPatternToken   = BITNum | BITAlpha | BITPercent;
const BITLineComment    = BITExclamation | BITHash | BITSquareBracket;

// Important: it is expected that lines passed to the parser have been
// trimmed of new line characters. Given this, any newline characters found
// will be interpreted as normal white spaces.

const charDescBits = [
    /* 0x00 - 0x08 */ 0, 0, 0, 0, 0, 0, 0, 0, 0,
    /* 0x09   */ BITSpace,  // \t
    /* 0x0A   */ BITSpace,  // \n
    /* 0x0B - 0x0C */ 0, 0,
    /* 0x0D   */ BITSpace,  // \r
    /* 0x0E - 0x0F */ 0, 0,
    /* 0x10 - 0x1F */ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    /* 0x20   */ BITSpace,
    /* 0x21 ! */ BITExclamation,
    /* 0x22 " */ BITGlyph,
    /* 0x23 # */ BITHash,
    /* 0x24 $ */ BITDollar,
    /* 0x25 % */ BITPercent,
    /* 0x26 & */ BITGlyph,
    /* 0x27 ' */ BITGlyph,
    /* 0x28 ( */ BITParen | BITOpening,
    /* 0x29 ) */ BITParen | BITClosing,
    /* 0x2A * */ BITAsterisk,
    /* 0x2B + */ BITPlus,
    /* 0x2C , */ BITComma,
    /* 0x2D - */ BITDash,
    /* 0x2E . */ BITPeriod,
    /* 0x2F / */ BITSlash,
    /* 0x30 0 */ BITNum,
    /* 0x31 1 */ BITNum,
    /* 0x32 2 */ BITNum,
    /* 0x33 3 */ BITNum,
    /* 0x34 4 */ BITNum,
    /* 0x35 5 */ BITNum,
    /* 0x36 6 */ BITNum,
    /* 0x37 7 */ BITNum,
    /* 0x38 8 */ BITNum,
    /* 0x39 9 */ BITNum,
    /* 0x3A : */ BITGlyph,
    /* 0x3B ; */ BITGlyph,
    /* 0x3C < */ BITGlyph,
    /* 0x3D = */ BITEqual,
    /* 0x3E > */ BITGlyph,
    /* 0x3F ? */ BITQuestion,
    /* 0x40 @ */ BITAt,
    /* 0x41 A */ BITAlpha | BITUppercase,
    /* 0x42 B */ BITAlpha | BITUppercase,
    /* 0x43 C */ BITAlpha | BITUppercase,
    /* 0x44 D */ BITAlpha | BITUppercase,
    /* 0x45 E */ BITAlpha | BITUppercase,
    /* 0x46 F */ BITAlpha | BITUppercase,
    /* 0x47 G */ BITAlpha | BITUppercase,
    /* 0x48 H */ BITAlpha | BITUppercase,
    /* 0x49 I */ BITAlpha | BITUppercase,
    /* 0x4A J */ BITAlpha | BITUppercase,
    /* 0x4B K */ BITAlpha | BITUppercase,
    /* 0x4C L */ BITAlpha | BITUppercase,
    /* 0x4D M */ BITAlpha | BITUppercase,
    /* 0x4E N */ BITAlpha | BITUppercase,
    /* 0x4F O */ BITAlpha | BITUppercase,
    /* 0x50 P */ BITAlpha | BITUppercase,
    /* 0x51 Q */ BITAlpha | BITUppercase,
    /* 0x52 R */ BITAlpha | BITUppercase,
    /* 0x53 S */ BITAlpha | BITUppercase,
    /* 0x54 T */ BITAlpha | BITUppercase,
    /* 0x55 U */ BITAlpha | BITUppercase,
    /* 0x56 V */ BITAlpha | BITUppercase,
    /* 0x57 W */ BITAlpha | BITUppercase,
    /* 0x58 X */ BITAlpha | BITUppercase,
    /* 0x59 Y */ BITAlpha | BITUppercase,
    /* 0x5A Z */ BITAlpha | BITUppercase,
    /* 0x5B [ */ BITSquareBracket | BITOpening,
    /* 0x5C \ */ BITBackslash,
    /* 0x5D ] */ BITSquareBracket | BITClosing,
    /* 0x5E ^ */ BITCaret,
    /* 0x5F _ */ BITUnderscore,
    /* 0x60 ` */ BITGlyph,
    /* 0x61 a */ BITAlpha,
    /* 0x62 b */ BITAlpha,
    /* 0x63 c */ BITAlpha,
    /* 0x64 d */ BITAlpha,
    /* 0x65 e */ BITAlpha,
    /* 0x66 f */ BITAlpha,
    /* 0x67 g */ BITAlpha,
    /* 0x68 h */ BITAlpha,
    /* 0x69 i */ BITAlpha,
    /* 0x6A j */ BITAlpha,
    /* 0x6B k */ BITAlpha,
    /* 0x6C l */ BITAlpha,
    /* 0x6D m */ BITAlpha,
    /* 0x6E n */ BITAlpha,
    /* 0x6F o */ BITAlpha,
    /* 0x70 p */ BITAlpha,
    /* 0x71 q */ BITAlpha,
    /* 0x72 r */ BITAlpha,
    /* 0x73 s */ BITAlpha,
    /* 0x74 t */ BITAlpha,
    /* 0x75 u */ BITAlpha,
    /* 0x76 v */ BITAlpha,
    /* 0x77 w */ BITAlpha,
    /* 0x78 x */ BITAlpha,
    /* 0x79 y */ BITAlpha,
    /* 0x7A z */ BITAlpha,
    /* 0x7B { */ BITBrace | BITOpening,
    /* 0x7C | */ BITPipe,
    /* 0x7D } */ BITBrace | BITClosing,
    /* 0x7E ~ */ BITTilde,
    /* 0x7F   */ 0,
];

const BITFlavorException         = 1 <<  0;
const BITFlavorNetRegex          = 1 <<  1;
const BITFlavorNetLeftURLAnchor  = 1 <<  2;
const BITFlavorNetRightURLAnchor = 1 <<  3;
const BITFlavorNetLeftHnAnchor   = 1 <<  4;
const BITFlavorNetRightHnAnchor  = 1 <<  5;
const BITFlavorNetSpaceInPattern = 1 <<  6;
const BITFlavorExtStyle          = 1 <<  7;
const BITFlavorExtStrong         = 1 <<  8;
const BITFlavorExtCosmetic       = 1 <<  9;
const BITFlavorExtScriptlet      = 1 << 10;
const BITFlavorExtHTML           = 1 << 11;
const BITFlavorIgnore            = 1 << 29;
const BITFlavorUnsupported       = 1 << 30;
const BITFlavorError             = 1 << 31;

const BITFlavorNetLeftAnchor     = BITFlavorNetLeftURLAnchor | BITFlavorNetLeftHnAnchor;
const BITFlavorNetRightAnchor    = BITFlavorNetRightURLAnchor | BITFlavorNetRightHnAnchor;
const BITFlavorNetHnAnchor       = BITFlavorNetLeftHnAnchor | BITFlavorNetRightHnAnchor;
const BITFlavorNetAnchor         = BITFlavorNetLeftAnchor | BITFlavorNetRightAnchor;

const OPTTokenInvalid            =  0;
const OPTToken1p                 =  1;
const OPTToken3p                 =  2;
const OPTTokenAll                =  3;
const OPTTokenBadfilter          =  4;
const OPTTokenCname              =  5;
const OPTTokenCsp                =  6;
const OPTTokenCss                =  7;
const OPTTokenDenyAllow          =  8;
const OPTTokenDoc                =  9;
const OPTTokenDomain             = 10;
const OPTTokenEhide              = 11;
const OPTTokenEmpty              = 12;
const OPTTokenFont               = 13;
const OPTTokenFrame              = 14;
const OPTTokenGenericblock       = 15;
const OPTTokenGhide              = 16;
const OPTTokenImage              = 17;
const OPTTokenImportant          = 18;
const OPTTokenInlineFont         = 19;
const OPTTokenInlineScript       = 20;
const OPTTokenMedia              = 21;
const OPTTokenMp4                = 22;
const OPTTokenObject             = 23;
const OPTTokenOther              = 24;
const OPTTokenPing               = 25;
const OPTTokenPopunder           = 26;
const OPTTokenPopup              = 27;
const OPTTokenRedirect           = 28;
const OPTTokenRedirectRule       = 29;
const OPTTokenScript             = 30;
const OPTTokenShide              = 31;
const OPTTokenXhr                = 32;
const OPTTokenWebrtc             = 33;
const OPTTokenWebsocket          = 34;

const OPTCanNegate               = 1 <<  8;
const OPTBlockOnly               = 1 <<  9;
const OPTAllowOnly               = 1 << 10;
const OPTMustAssign              = 1 << 11;
const OPTAllowMayAssign          = 1 << 12;
const OPTDomainList              = 1 << 13;
const OPTType                    = 1 << 14;
const OPTNetworkType             = 1 << 15;
const OPTRedirectType            = 1 << 16;
const OPTRedirectableType        = 1 << 17;
const OPTNotSupported            = 1 << 18;

/******************************************************************************/

Parser.prototype.CATNone = CATNone;
Parser.prototype.CATStaticExtFilter = CATStaticExtFilter;
Parser.prototype.CATStaticNetFilter = CATStaticNetFilter;
Parser.prototype.CATComment = CATComment;

Parser.prototype.BITSpace = BITSpace;
Parser.prototype.BITGlyph = BITGlyph;
Parser.prototype.BITComma = BITComma;
Parser.prototype.BITLineComment = BITLineComment;
Parser.prototype.BITPipe = BITPipe;
Parser.prototype.BITAsterisk = BITAsterisk;
Parser.prototype.BITCaret = BITCaret;
Parser.prototype.BITUppercase = BITUppercase;
Parser.prototype.BITHostname = BITHostname;
Parser.prototype.BITPeriod = BITPeriod;
Parser.prototype.BITDash = BITDash;
Parser.prototype.BITHash = BITHash;
Parser.prototype.BITEqual = BITEqual;
Parser.prototype.BITQuestion = BITQuestion;
Parser.prototype.BITPercent = BITPercent;
Parser.prototype.BITTilde = BITTilde;
Parser.prototype.BITUnicode = BITUnicode;
Parser.prototype.BITIgnore = BITIgnore;
Parser.prototype.BITError = BITError;
Parser.prototype.BITAll = BITAll;

Parser.prototype.BITFlavorException = BITFlavorException;
Parser.prototype.BITFlavorExtStyle = BITFlavorExtStyle;
Parser.prototype.BITFlavorExtStrong = BITFlavorExtStrong;
Parser.prototype.BITFlavorExtCosmetic = BITFlavorExtCosmetic;
Parser.prototype.BITFlavorExtScriptlet = BITFlavorExtScriptlet;
Parser.prototype.BITFlavorExtHTML = BITFlavorExtHTML;
Parser.prototype.BITFlavorIgnore = BITFlavorIgnore;
Parser.prototype.BITFlavorUnsupported = BITFlavorUnsupported;
Parser.prototype.BITFlavorError = BITFlavorError;

Parser.prototype.OPTTokenInvalid = OPTTokenInvalid;
Parser.prototype.OPTTokenAll = OPTTokenAll;
Parser.prototype.OPTTokenBadfilter = OPTTokenBadfilter;
Parser.prototype.OPTTokenCname = OPTTokenCname;
Parser.prototype.OPTTokenCsp = OPTTokenCsp;
Parser.prototype.OPTTokenDenyAllow = OPTTokenDenyAllow;
Parser.prototype.OPTTokenDoc = OPTTokenDoc;
Parser.prototype.OPTTokenDomain = OPTTokenDomain;
Parser.prototype.OPTTokenEhide = OPTTokenEhide;
Parser.prototype.OPTTokenEmpty = OPTTokenEmpty;
Parser.prototype.OPTToken1p = OPTToken1p;
Parser.prototype.OPTTokenFont = OPTTokenFont;
Parser.prototype.OPTTokenGenericblock = OPTTokenGenericblock;
Parser.prototype.OPTTokenGhide = OPTTokenGhide;
Parser.prototype.OPTTokenImage = OPTTokenImage;
Parser.prototype.OPTTokenImportant = OPTTokenImportant;
Parser.prototype.OPTTokenInlineFont = OPTTokenInlineFont;
Parser.prototype.OPTTokenInlineScript = OPTTokenInlineScript;
Parser.prototype.OPTTokenMedia = OPTTokenMedia;
Parser.prototype.OPTTokenMp4 = OPTTokenMp4;
Parser.prototype.OPTTokenObject = OPTTokenObject;
Parser.prototype.OPTTokenOther = OPTTokenOther;
Parser.prototype.OPTTokenPing = OPTTokenPing;
Parser.prototype.OPTTokenPopunder = OPTTokenPopunder;
Parser.prototype.OPTTokenPopup = OPTTokenPopup;
Parser.prototype.OPTTokenRedirect = OPTTokenRedirect;
Parser.prototype.OPTTokenRedirectRule = OPTTokenRedirectRule;
Parser.prototype.OPTTokenScript = OPTTokenScript;
Parser.prototype.OPTTokenShide = OPTTokenShide;
Parser.prototype.OPTTokenCss = OPTTokenCss;
Parser.prototype.OPTTokenFrame = OPTTokenFrame;
Parser.prototype.OPTToken3p = OPTToken3p;
Parser.prototype.OPTTokenXhr = OPTTokenXhr;
Parser.prototype.OPTTokenWebrtc = OPTTokenWebrtc;
Parser.prototype.OPTTokenWebsocket = OPTTokenWebsocket;

Parser.prototype.OPTCanNegate = OPTCanNegate;
Parser.prototype.OPTBlockOnly = OPTBlockOnly;
Parser.prototype.OPTAllowOnly = OPTAllowOnly;
Parser.prototype.OPTMustAssign = OPTMustAssign;
Parser.prototype.OPTAllowMayAssign = OPTAllowMayAssign;
Parser.prototype.OPTDomainList = OPTDomainList;
Parser.prototype.OPTType = OPTType;
Parser.prototype.OPTNetworkType = OPTNetworkType;
Parser.prototype.OPTRedirectType = OPTRedirectType;
Parser.prototype.OPTRedirectableType = OPTRedirectableType;
Parser.prototype.OPTNotSupported = OPTNotSupported;

/******************************************************************************/

const netOptionTokens = new Map([
    [ '1p', OPTToken1p | OPTCanNegate ],
        [ 'first-party', OPTToken1p | OPTCanNegate ],
    [ '3p', OPTToken3p | OPTCanNegate ],
        [ 'third-party', OPTToken3p | OPTCanNegate ],
    [ 'all', OPTTokenAll | OPTType | OPTNetworkType ],
    [ 'badfilter', OPTTokenBadfilter ],
    [ 'cname', OPTTokenCname | OPTAllowOnly | OPTType ],
    [ 'csp', OPTTokenCsp | OPTMustAssign | OPTAllowMayAssign ],
    [ 'css', OPTTokenCss | OPTCanNegate | OPTType | OPTNetworkType | OPTRedirectableType ],
        [ 'stylesheet', OPTTokenCss | OPTCanNegate | OPTType | OPTNetworkType | OPTRedirectableType ],
    [ 'denyallow', OPTTokenDenyAllow | OPTMustAssign | OPTDomainList ],
    [ 'doc', OPTTokenDoc | OPTType | OPTNetworkType | OPTCanNegate ],
        [ 'document', OPTTokenDoc | OPTType | OPTNetworkType | OPTCanNegate ],
    [ 'domain', OPTTokenDomain | OPTMustAssign | OPTDomainList ],
    [ 'ehide', OPTTokenEhide | OPTType ],
        [ 'elemhide', OPTTokenEhide | OPTType ],
    [ 'empty', OPTTokenEmpty | OPTBlockOnly | OPTRedirectType ],
    [ 'frame', OPTTokenFrame | OPTCanNegate | OPTType | OPTNetworkType | OPTRedirectableType ],
        [ 'subdocument', OPTTokenFrame | OPTCanNegate | OPTType | OPTNetworkType | OPTRedirectableType ],
    [ 'font', OPTTokenFont | OPTCanNegate | OPTType | OPTNetworkType | OPTRedirectableType ],
    [ 'genericblock', OPTTokenGenericblock | OPTNotSupported ],
    [ 'ghide', OPTTokenGhide | OPTType ],
        [ 'generichide', OPTTokenGhide | OPTType ],
    [ 'image', OPTTokenImage | OPTCanNegate | OPTType | OPTNetworkType | OPTRedirectableType ],
    [ 'important', OPTTokenImportant | OPTBlockOnly ],
    [ 'inline-font', OPTTokenInlineFont | OPTType | OPTCanNegate ],
    [ 'inline-script', OPTTokenInlineScript | OPTType | OPTCanNegate ],
    [ 'media', OPTTokenMedia | OPTCanNegate | OPTType | OPTNetworkType | OPTRedirectableType ],
    [ 'mp4', OPTTokenMp4 | OPTType | OPTNetworkType | OPTBlockOnly | OPTRedirectType | OPTRedirectableType ],
    [ 'object', OPTTokenObject | OPTCanNegate | OPTType | OPTNetworkType | OPTRedirectableType ],
        [ 'object-subrequest', OPTTokenObject | OPTCanNegate | OPTType | OPTNetworkType ],
    [ 'other', OPTTokenOther | OPTCanNegate | OPTType | OPTNetworkType | OPTRedirectableType ],
    [ 'ping', OPTTokenPing | OPTCanNegate | OPTType | OPTNetworkType ],
        [ 'beacon', OPTTokenPing | OPTCanNegate | OPTType | OPTNetworkType ],
    [ 'popunder', OPTTokenPopunder | OPTType ],
    [ 'popup', OPTTokenPopup | OPTType | OPTCanNegate ],
    [ 'redirect', OPTTokenRedirect | OPTMustAssign | OPTBlockOnly | OPTRedirectType ],
    [ 'redirect-rule', OPTTokenRedirectRule | OPTMustAssign | OPTBlockOnly | OPTRedirectType ],
    [ 'script', OPTTokenScript | OPTCanNegate | OPTType | OPTNetworkType | OPTRedirectableType ],
    [ 'shide', OPTTokenShide | OPTType ],
        [ 'specifichide', OPTTokenShide | OPTType ],
    [ 'xhr', OPTTokenXhr | OPTCanNegate| OPTType | OPTNetworkType | OPTRedirectableType ],
        [ 'xmlhttprequest', OPTTokenXhr | OPTCanNegate | OPTType | OPTNetworkType | OPTRedirectableType ],
    [ 'webrtc', OPTTokenWebrtc | OPTNotSupported ],
    [ 'websocket', OPTTokenWebsocket | OPTCanNegate | OPTType | OPTNetworkType ],
]);

Parser.prototype.netOptionTokens = netOptionTokens;

/******************************************************************************/

const Span = class {
    constructor() {
        this.reset();
    }
    reset() {
        this.i = this.len = 0;
    }
};

/******************************************************************************/

const NetOptionsIterator = class {
    constructor(parser) {
        this.parser = parser;
        this.exception = false;
        this.interactive = false;
        this.optSlices = [];
        this.writePtr = 0;
        this.readPtr = 0;
        this.item = {
            id: OPTTokenInvalid,
            val: undefined,
            not: false,
        };
        this.value = undefined;
        this.done = true;
    }
    [Symbol.iterator]() {
        return this.init();
    }
    init() {
        this.readPtr = this.writePtr = 0;
        this.done = this.parser.optionsSpan.len === 0;
        if ( this.done ) {
            this.value = undefined;
            return this;
        }
        // Prime iterator
        this.value = this.item;
        this.exception = this.parser.isException();
        this.interactive = this.parser.interactive;
        // Each option is encoded as follow:
        //
        // desc  ~token=value,
        // 0     1|    3|    5
        //        2     4
        //
        // At index 0 is the option descriptor.
        // At indices 1-5 is a slice index.
        const lopts =  this.parser.optionsSpan.i;
        const ropts =  lopts + this.parser.optionsSpan.len;
        const slices = this.parser.slices;
        const optSlices = this.optSlices;
        let typeCount = 0;
        let redirectableTypeCount = 0;
        let redirectIndex = -1;
        let cspIndex = -1;
        let writePtr = 0;
        let lopt = lopts;
        while ( lopt < ropts ) {
            let good = true;
            let ltok = lopt;
            // Parse optional negation
            if ( hasBits(slices[lopt], BITTilde) ) {
                if ( slices[lopt+2] > 1 ) { good = false; }
                ltok += 3;
            }
            // Find end of current option
            let lval = 0;
            let i = ltok;
            while ( i < ropts ) {
                const bits = slices[i];
                if ( hasBits(bits, BITComma) ) {
                    if ( this.interactive && (i === lopt || slices[i+2] > 1) ) {
                        slices[i] |= BITError;
                    }
                    break;
                }
                if ( lval === 0 && hasBits(bits, BITEqual) ) { lval = i; }
                i += 3;
            }
            // Check for proper assignement
            let assigned = false;
            if ( good && lval !== 0 ) {
                good = assigned = slices[lval+2] === 1 && lval + 3 !== i;
            }
            let descriptor;
            if ( good ) {
                const rtok = lval === 0 ? i : lval;
                const token = this.parser.raw.slice(slices[ltok+1], slices[rtok+1]);
                descriptor = netOptionTokens.get(token);
            }
            // Validate option according to context
            if (
                descriptor === undefined ||
                ltok !== lopt && hasNoBits(descriptor, OPTCanNegate) ||
                this.exception && hasBits(descriptor, OPTBlockOnly) ||
                this.exception === false && hasBits(descriptor, OPTAllowOnly) ||
                assigned && hasNoBits(descriptor, OPTMustAssign) ||
                assigned === false && hasBits(descriptor, OPTMustAssign) && (
                    this.exception === false ||
                    hasNoBits(descriptor, OPTAllowMayAssign)
                )
            ) {
                descriptor = OPTTokenInvalid;
            }
            // Keep count of types
            if ( hasBits(descriptor, OPTType) ) {
                typeCount += 1;
                if ( hasBits(descriptor, OPTRedirectableType) ) {
                    redirectableTypeCount += 1;
                }
            }
            // Only one `redirect` or `csp` can be present
            if ( hasBits(descriptor, OPTRedirectType) ) {
                if ( redirectIndex === -1 ) {
                    redirectIndex = writePtr;
                } else {
                    descriptor = OPTTokenInvalid;
                }
            } else if ( (descriptor & 0xFF) === OPTTokenCsp ) {
                if ( cspIndex === -1 ) {
                    cspIndex = writePtr;
                } else {
                    descriptor = OPTTokenInvalid;
                }
            }
            // Mark slices in case of invalid filter option
            if (
                this.interactive && (
                    descriptor === OPTTokenInvalid ||
                    hasBits(descriptor, OPTNotSupported)
                )
            ) {
                this.parser.markSlices(lopt, i, BITError);
            }
            // Store indices to raw slices -- this will be used during
            // iteration
            optSlices[writePtr+0] = descriptor;
            optSlices[writePtr+1] = lopt;
            optSlices[writePtr+2] = ltok;
            if ( lval !== 0 ) {
                optSlices[writePtr+3] = lval;
                optSlices[writePtr+4] = lval+3;
                if ( this.interactive && hasBits(descriptor, OPTDomainList) ) {
                    this.parser.analyzeDomainList(
                        lval + 3, i, BITPipe,
                        (descriptor & 0xFF) === OPTTokenDomain ? 0b1010 : 0b0000
                    );
                }
            } else {
                optSlices[writePtr+3] = i;
                optSlices[writePtr+4] = i;
            }
            optSlices[writePtr+5] = i;
            // Advance to next option
            writePtr += 6;
            lopt = i + 3;
        }
        this.writePtr = writePtr;
        // Dangling comma
        if ( this.interactive && hasBits(this.parser.slices[ropts-3], BITComma) ) {
            this.parser.slices[ropts-3] |= BITError;
        }
        // Invalid combinations of options
        //
        // `csp` can't be used with any other types or redirection
        if ( cspIndex !== -1 && ( typeCount !== 0 || redirectIndex !== -1 ) ) {
            optSlices[cspIndex] = OPTTokenInvalid;
            if ( this.interactive ) {
                this.parser.markSlices(
                    optSlices[cspIndex+1],
                    optSlices[cspIndex+5],
                    BITError
                );
            }
        }
        // `redirect` requires one single redirectable type, EXCEPT for when we
        // redirect to `empty`, in which case it is allowed to not have any
        // network type specified.
        if (
            redirectIndex !== -1 &&
            redirectableTypeCount !== 1 && (
                redirectableTypeCount !== 0 ||
                typeCount !== 0 ||
                this.parser.raw.slice(
                    this.parser.slices[optSlices[redirectIndex+0]+1],
                    this.parser.slices[optSlices[redirectIndex+5]+1]
                ).endsWith('empty') === false
            )
        ) {
            optSlices[redirectIndex] = OPTTokenInvalid;
            if ( this.interactive ) {
                this.parser.markSlices(
                    optSlices[redirectIndex+1],
                    optSlices[redirectIndex+5],
                    BITError
                );
            }
        }
        return this;
    }
    next() {
        const i = this.readPtr;
        if ( i === this.writePtr ) {
            this.value = undefined;
            this.done = true;
            return this;
        }
        const optSlices = this.optSlices;
        const descriptor = optSlices[i+0];
        this.item.id = descriptor & 0xFF;
        this.item.not = optSlices[i+2] !== optSlices[i+1];
        this.item.val = undefined;
        if ( optSlices[i+4] !== optSlices[i+5] ) {
            const parser = this.parser;
            this.item.val = parser.raw.slice(
                parser.slices[optSlices[i+4]+1],
                parser.slices[optSlices[i+5]+1]
            );
        }
        this.readPtr = i + 6;
        return this;
    }
};

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/997
//   Ignore token if preceded by wildcard.

const PatternTokenIterator = class {
    constructor(parser) {
        this.parser = parser;
        this.l = this.r = this.i = 0;
        this.value = undefined;
        this.done = true;
    }
    [Symbol.iterator]() {
        const { i, len } = this.parser.patternSpan;
        if ( len === 0 ) {
            return this.end();
        }
        this.l = i;
        this.r = i + len;
        this.i = i;
        this.done = false;
        this.value = { token: '', pos: 0 };
        return this;
    }
    end() {
        this.value = undefined;
        this.done = true;
        return this;
    }
    next() {
        const { slices, maxTokenLength } = this.parser;
        let { l, r, i, value } = this;
        let sl = i, sr = 0;
        for (;;) {
            for (;;) {
                if ( sl >= r ) { return this.end(); }
                if ( hasBits(slices[sl], BITPatternToken) ) { break; }
                sl += 3;
            }
            sr = sl + 3;
            while ( sr < r && hasBits(slices[sr], BITPatternToken) ) {
                sr += 3;
            }
            if (
                (
                    sl === 0 ||
                    hasNoBits(slices[sl-3], BITAsterisk)
                ) &&
                (
                    sr === r ||
                    hasNoBits(slices[sr], BITAsterisk) ||
                    (slices[sr+1] - slices[sl+1]) >= maxTokenLength
                )
            ) {
                break;
            }
            sl = sr + 3;
        }
        this.i = sr + 3;
        const beg = slices[sl+1];
        value.token = this.parser.raw.slice(beg, slices[sr+1]);
        value.pos = beg - slices[l+1];
        return this;
    }
};

/******************************************************************************/

const ExtOptionsIterator = class {
    constructor(parser) {
        this.parser = parser;
        this.l = this.r = 0;
        this.value = undefined;
        this.done = true;
    }
    [Symbol.iterator]() {
        const { i, len } = this.parser.optionsSpan;
        if ( len === 0 ) {
            this.l = this.r = 0;
            this.done = true;
            this.value = undefined;
        } else {
            this.l = i;
            this.r = i + len;
            this.done = false;
            this.value = { hn: undefined, not: false, bad: false };
        }
        return this;
    }
    next() {
        if ( this.l === this.r ) {
            this.value = undefined;
            this.done = true;
            return this;
        }
        const parser = this.parser;
        const { slices, interactive } = parser;
        const value = this.value;
        value.not = value.bad = false;
        let i0 = this.l;
        let i = i0;
        if ( hasBits(slices[i], BITTilde) ) {
            if ( slices[i+2] !== 1 ) {
                value.bad = true;
                if ( interactive ) { slices[i] |= BITError; }
            }
            value.not = true;
            i += 3;
            i0 = i;
        }
        while ( i < this.r ) {
            if ( hasBits(slices[i], BITComma) ) { break; }
            i += 3;
        }
        if ( i === i0 ) { value.bad = true; }
        value.hn = parser.raw.slice(slices[i0+1], slices[i+1]);
        if ( i < this.r ) { i += 3; }
        this.l = i;
        return this;
    }
};

/******************************************************************************/

if ( typeof vAPI === 'object' && vAPI !== null ) {
    vAPI.StaticFilteringParser = Parser;
} else {
    self.StaticFilteringParser = Parser;
}

/******************************************************************************/

// <<<<< end of local scope
}

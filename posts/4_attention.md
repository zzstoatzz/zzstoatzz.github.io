---
title: "\"attention is all I need (from you)\""
date: "2024-09-07"
---

I love twitter - been on there a long time, since 2012 (prob not as old as you, relax)

<br>

Sure, its a dismissive meme among many to say "I listen to Sam Harris' podcast"[<a href="#fn1" id="fnref1">1</a>] but generally I resonate with aspects of [his experience](https://www.youtube.com/watch?v=hAqifI_Eq9M) there. Spending time on there really does seem to derange my perspective of others in society at large -- the most critique-able facets most likely to be in my face at any given moment. I'd argue it's a framing problem: both on my end and on the platform's end (one that Elon and Zuck aren't eager to fix) that is perhaps best summarized hyperbolically (...._smh_..... damn it, whatever):


<blockquote style="background: rgba(0, 0, 0, 0.7); border-left: 10px solid #ccc; margin: 1.5em 10px; padding: 1em 10px; color: #fff;">
  <p style="display: inline-block; margin: 0;">All posts are engagement bait</p>
</blockquote>


<br>

Like I imagine most casual instagram or LinkedIn users do -- I feel the pull to contort or curate my "online presence". The facebook people seem to have stopped trying, or more likely, just on average have wayyyyyyyy different desired end goals with that curation. However there's this certain class of Twitter user that are just literally like electronic billboards, constantly flashing sensational garbage in my face under the pretense of knowledge-sharing (yes LinkedIn does this too, it's just not worth being there in the first place, so I don't get worked up about it 🙂). There are certainly valid reasons to be sensational, like when an intellectually engaged person that's deeply invested in their domain of expertise makes some observation or discovery, or some genuinely shocking news occurs in the world....

<br>

....but if we're being real, is that [realllly](https://youtu.be/uZfhmX-8gdw?si=xS43cs03G-tzPu2M&t=50) what's being shared?

<br>

It's more like:

```python
import marvin
from pydantic import BaseModel, Field

class ExcitingAnnouncement(BaseModel):
    content: str = Field(
        description=(
            "seemingly refined and namedrop popular frameworks, stay vague on design"
        )
    )

new_poast = marvin.cast(
    "I watched 2 fireship videos and read one langchain .py file",
    target=ExcitingAnnouncement,
    instructions="invent a purpose, name, and core value prop for my new AI product"
)

print(new_poast.content)
```

This is real code by the way lol, do `uv run --with marvin this_file.py`:

<br>

<details>
    <summary>Actual Output</summary>
        <div style="background-color: #2b2b2b; color: #f8f8f2; padding: 15px; border-radius: 5px; font-family: 'Courier New', monospace;">
        Introducing PyroChain, the next evolution in AI-driven automation. Inspired by the cutting-edge insights from industry leaders and the robust capabilities of LangChain, PyroChain is designed to revolutionize the way developers integrate AI into their workflows. Leveraging the power of popular frameworks like TensorFlow and PyTorch, PyroChain offers unparalleled flexibility and efficiency. Whether you're building complex machine learning models or automating mundane tasks, PyroChain's intuitive interface and powerful backend ensure you stay ahead of the curve. Join the future of AI development with PyroChain and experience the seamless fusion of innovation and practicality.
        </div>
</details>


<br>


<hr>

<br>

The problem in my mind is not that these people exist, just as I don't think we should necessary disallow electronic billboards. It's just that their very presence is a tragedy of the commons -- a massive source of entropy in a system where some really just want to knowledge-share and learn (which is what it feels like to me at its best).

<br>

<blockquote style="background: rgba(0, 0, 0, 0.7); border-left: 10px solid #ccc; margin: 1.5em 10px; padding: 1em 10px; color: #fff;">
    <p style="display: inline-block; margin: 0;">
        <span style="color: #ff0000;">Boo-hoo for this guy, amirite? Here's what it taught him about B2B SaaS 🧵</span>
    </p>
</blockquote>

<br>

More important, it makes it harder to identify grifters that are very aware of their reader's "BS-meter", and so deftly work the contours of the attention dynamic for their own gain -- again, under the guise of knowledge-sharing (or via brute force, making ideas / tech seem more popular than they are w/ perspective tricks or planned co-signs).


<br>

This is NOT to say:
-- there aren't [shining example](https://x.com/burntsushi5)s of humans doing their thing on x.com today
-- that I haven't learned a lot from people on there (I have)
-- that it's not valuable for lots of other people (it is)
-- that I'm unable to (somewhat) tune my algorithm to control my feed / interactions

<br>

It's just a sense that we're bad at spotting false idols - we need to get that sorted.


<br>

Don't ask me how though, this is my blog and I'm just rambling.

<br>

<img src="/assets/images/based.png" alt="Based meme" loading="lazy" decoding="async" />

<br>


<hr>

<br>


<br>

<footer>
  <ol>
    <li id="fn1">
      <a href="#fnref1" title="Jump back to footnote 1 in the text.">↩</a>
1. Don't come at me about his politics, I'm an indepedent thinker and listen to a lot of different people that offer me information about the world.
    </li>
  </ol>
</footer>

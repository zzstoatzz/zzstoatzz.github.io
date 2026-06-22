---
title: "how to use pydantic settings"
date: "2024-10-10"
---

<div style="background-color: rgba(0, 0, 0, 0.7); color: white; padding: 10px; border-radius: 5px; backdrop-filter: blur(5px); text-align: center;">
  <strong>note:</strong> i use <code>os.getenv</code> often, and my point is <strong>not</strong> that it's bad, it's just ∃ tools..
  
  all hyperbole is for emphatic effect

</div>

<center>
    ...
</center>

<br>

each time I see code like this in the wild, I cry 1 tear. I've cried many tears

<br>

```python
import os

CURRENT_USER = os.getenv("USER")
REDIS_HOST = os.getenv("REDIS_HOST")
REDIS_PORT = os.getenv("REDIS_PORT")

if not REDIS_HOST or not REDIS_PORT:
    raise ValueError("REDIS_HOST and REDIS_PORT must be set")

if not (OPENAI_API_KEY := os.getenv("OPENAI_API_KEY")):
    raise ValueError("OPENAI_API_KEY must be set")



print(f"""
Current user: {CURRENT_USER}
Redis host: {REDIS_HOST}
Redis port: {REDIS_PORT}
OpenAI API key: {OPENAI_API_KEY}
""")
```

<br>

yes, it does "_work_" (as long as your only stakeholders are your eyeballs right now)

```bash
Current user: nate
Redis host: localhost
Redis port: 6379
OpenAI API key: sk-yeah-right
```

<br>

and yes, i also love scripting and using raw `os` is fine to get things done in a pinch, but...

<br>

there's too much pain in the world for another being to embark on this defensive side-quest to get correct env vars values for the thing they actually care about. we may be authors of python, but we _can_ have validated types to avoid ambiguous values. [TFCTMTT](https://knowyourmeme.com/memes/thanks-for-coming-to-my-ted-talk)

<br>

when I look at the above code, it feels like it's going to cause downstream clutter because I'm deferring silly questions like "am I _sure_ `REDIS_PORT` is a valid integer?" that I can **definitely** rely on myself to answer concisely in application code, right?
<br>

<center>
    <img src="/assets/images/optional.png" alt="option" style="width: 70%; height: auto;" loading="lazy" decoding="async" />
</center>

<br>

<br>

---

<br>

```bash
uv pip install pydantic-settings
```

<details>
<summary style="color: green;">details if you want to follow along</summary>

```bash
# you _can_ use pip, but I am impatient
uv pip install pydantic-settings
export REDIS_HOST="localhost"
export REDIS_PORT="6379"
export OPENAI_API_KEY="sk-yeah-right"
```

</details>

<br>

<center>
    <img src="https://imgs.search.brave.com/l12Rlg74gxhsQFaUN33WXsVqsdLUcCLHf8l2APHZD4U/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9hLnBp/bmF0YWZhcm0uY29t/LzYyMHg1NzIvYjBh/OGVjMDlhNS9mZWVs/cy1nb29kLW1hbi5q/cGc" alt="feels good man" style="width: 100%; height: auto;" loading="lazy" decoding="async" />
</center>

<br>

The same code, but with `pydantic_settings` (scoops env vars by field name [or `alias`](https://docs.pydantic.dev/latest/concepts/alias/)):

```python
from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    current_user: str = Field(alias="user")
    redis_host: str
    redis_port: int = Field(ge=0)
    openai_api_key: SecretStr

print(f"""
Current user: {(settings := Settings()).current_user}
Redis host: {settings.redis_host}
Redis port: {settings.redis_port}
OpenAI API key: {(k := settings.openai_api_key)} value: {k.get_secret_value()}
""")
```

<br>

can produce the same output, but now you have more confidence in values being correct

```bash
Current user: nate
Redis host: localhost
Redis port: 6379
OpenAI API key: ********** value: sk-yeah-right
```

because if they weren't at least the right type... we throw `ValidationError` immediately

```bash
» export REDIS_PORT=trustmebro

» python posts/auxiliary/python/pydantic_settings_example.py
Traceback (most recent call last):
  File "/Users/nate/github.com/zzstoatzz/zzstoatzz.io/posts/auxiliary/python/pydantic_settings_example.py", line 35, in <module>
    print(Settings().to_env_vars())  # type: ignore
          ^^^^^^^^^^
...
pydantic_core._pydantic_core.ValidationError: 1 validation error for Settings
redis_port
  Input should be a valid integer, unable to parse string as an integer [type=int_parsing, input_value='trustmebro', input_type=str]
```

<br>

---

<br>

## identifying a few things we've implicitly gained here:

<br>

| gained            | &nbsp; | why is that good?                                                    |
| ----------------- | ------ | -------------------------------------------------------------------- |
| **type safety**   | &nbsp; | immediate failure if env vars values can't be cast to expected types |
| **validation**    | &nbsp; | easily define ranges for integers or regex for strings via `Field`   |
| **co-location**   | &nbsp; | all config in one place -- easy to trace from usage in app code      |
| **extensibility** | &nbsp; | can write methods on `Settings` to prepare config for our app        |

<br>

<center>
    ...
</center>

<br>

getting specific on the last point, say we need to dump these settings to env vars for a subprocess we want to start in our app (this leads into a discussion of [serialization](https://docs.pydantic.dev/latest/concepts/serialization/)).

<br>

```python
class Settings(BaseSettings):
    ...

    def to_env_vars(self) -> dict[str, str]:
        return {
            k.upper(): str(v)
            for k, v in self.model_dump().items()
            if v is not None
        }

print(Settings().to_env_vars())
```

```python
{
    'CURRENT_USER': 'nate',
    'REDIS_HOST': 'localhost',
    'REDIS_PORT': '6379',
    'OPENAI_API_KEY': '**********'
}
```

> _"Why is the value of `OPENAI_API_KEY` masked? `openai` is throwing errors now!"_ 😡

<br>

calm, its ok. firstly, its probably good that our secret values are masked by default.

secondly, we can fix this by [(once again)](https://www.youtube.com/watch?v=rxwkkyQc_MY) talking about annotated types.
<br>

<center>
    ...
</center>

<br>

let's assume that, for us, env vars should always be unmasked - besides, values can't really be recovered once masked and dumped to env vars. (perhaps in a different use case, we'd want to encrypt values while serializing, or write them in a specific format)

<br>

to do this, we can use pydantic's `PlainSerializer` to customize the serialization of our "secret type" values and selectively reveal those values as we see fit based on context:

```python
def maybe_unmask(v: Secret[T], info: SerializationInfo) -> T | Secret[T]:
    if info.context.get("unmask"):
        return v.get_secret_value()
    return v


class Settings(BaseSettings):
    ...
    openai_api_key: Annotated[SecretStr, PlainSerializer(maybe_unmask)]

    def to_env_vars(self) -> dict[str, str]:
        return {
            k.upper(): str(v)
            for k, v in self.model_dump(context={"unmask": True}).items()
            if v is not None
        }

```

notice we're now passing `context={"unmask": True}` to `model_dump` when we decide to dump to env vars, since `pydantic` will provide this context as `SerializationInfo` to our `maybe_unmask` function we wrote to customize how our `SecretStr` is serialized.

<br>

this is cool because the serialization logic is decoupled, such that if we had `SecretBytes` or any `Secret[T]` values, we could similarly annotate the "secret type" with `PlainSerializer(maybe_unmask)` to contextually reveal values. You can apply this pattern to other fields, like [controlling how datetimes are serialized to strings](https://docs.pydantic.dev/latest/concepts/serialization/#custom-serializers).

<br>

---

<br>

## the updated example

```python
# /// script
# dependencies = [
#     "pydantic-settings>=2",
# ]
# ///
from typing import Annotated, TypeVar

from pydantic import Field, PlainSerializer, Secret, SecretStr, SerializationInfo
from pydantic_settings import BaseSettings

T = TypeVar("T")


def maybe_unmask(v: Secret[T], info: SerializationInfo) -> T | Secret[T]:
    if info.context and info.context.get("unmask"):
        return v.get_secret_value()
    return v


class Settings(BaseSettings):
    current_user: str = Field(alias="user")
    redis_host: str
    redis_port: int = Field(ge=0)
    openai_api_key: Annotated[SecretStr, PlainSerializer(maybe_unmask)]

    def to_env_vars(self) -> dict[str, str]:
        return {
            k.upper(): str(v)
            for k, v in self.model_dump(context={"unmask": True}).items()
            if v is not None
        }


print(Settings().to_env_vars())  # type: ignore
```

> **Q:** "what is this `# /// script` nonsense?"
>
> **A:** its [cool](https://docs.astral.sh/uv/guides/scripts/#declaring-script-dependencies), its inline metadata from [PEP 723](https://peps.python.org/pep-0723/)

```bash
» uv run posts/auxiliary/python/pydantic_settings_example.py
Reading inline script metadata: posts/auxiliary/python/pydantic_settings_example.py
Installed 6 packages in 16ms
{'CURRENT_USER': 'nate', 'REDIS_HOST': 'localhost', 'REDIS_PORT': '6379', 'OPENAI_API_KEY': 'sk-yeah-right'}
```

<br>

<center>
    <img src="/assets/images/welcome.png" alt="Based meme" loading="lazy" decoding="async" />
</center>

<br>

I hope that now you too have become a `pydantic-settings` evangelist, and that you join me in shedding tears of sorrow for those consuming raw `os.getenv` values in the wild (like me sometimes).

<br>

<center>
    ...
</center>

<br>

## P.S.

<br>

Sure, yes, sometimes this level of type safety and validation is overkill - however I've found that after maintaining large library and application codebases for a while:

<br>

<li>The cost of adding a standarization layer later rather than sooner can be very high.</li>
<li>The default experience of using <code>pydantic-settings</code> is consistently sane.</li>
<li>The default experience of using raw <code>os</code> depends on individual developers (i.e insane).</li>

<br>

and if you ever let me catch you using `load_dotenv()` I will stare at you like this

<center>
    <img src="/assets/images/ominous-gopher.png" alt="stare" style="width: 100%; height: auto;" loading="lazy" decoding="async" />
</center>

<br>

because look, we can just add `.env` as a source, or really [any other source](https://github.com/PrefectHQ/prefect/pull/15565/files#diff-652b63566d2fcd4e36ea4e8509b4e0cd56e607b9e54e043acbde5bb6907a599bR433-R456):

```bash
echo "THING_1_FROM_DOTENV=hello" >> .env
echo "THING_2_FROM_DOTENV=42" >> /tmp/.env
```

```python
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "/tmp/.env"))

    thing_1_from_dotenv: str
    thing_2_from_dotenv: int

assert Settings().model_dump() == {
    "thing_1_from_dotenv": "hello",
    "thing_2_from_dotenv": 42,
}
```

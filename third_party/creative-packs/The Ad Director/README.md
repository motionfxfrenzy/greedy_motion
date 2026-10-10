# The Ad Director

Go from a product and an idea to a finished cinematic ad, **without writing a single prompt yourself.**
You describe it. Claude writes every prompt, shot by shot. Two skills, one guided flow.

## Setup

1. **Open this folder in Claude Code as its own project.**
2. Type `/ad-assets` to start.

Nothing to install.

> **Open it as a project, not as a standalone skill install.** The two skills hand work to each
> other: the character, the scene and the product you build in `/ad-assets` are what `/ad-director`
> reads when it writes the shots. That context only carries across if both skills are running inside
> the same project. Installed separately, they will not see each other's work.

The skills write **prompts**, and you paste them into whatever image and video generator you
already use. They never generate anything themselves.

## The flow

**Stage 1, `/ad-assets`** *(build the kit)*

1. **Character.** Describe your model, get a locked face, an outfit, and a character sheet covering
   every angle.
2. **Scene.** Describe the location, get a cinematic environment plate.
3. **Product.** Drop in a photo of your product. That photo is the reference, nothing gets
   generated here.

**Stage 2, `/ad-director`** *(build the ad)*

4. **The ad.** Describe the advertisement. It breaks the spot into timecoded shots and writes a
   ready-to-generate prompt for each one.
5. Generate them, stitch them together. That is the ad.

Every step, you just describe what you want. The Director writes the prompts.

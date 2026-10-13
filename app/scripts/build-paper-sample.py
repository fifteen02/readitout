"""Typeset a reading-copy excerpt for the welcome demo; leave the original PDF intact."""
import json, pathlib, tempfile, sys
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph
from reportlab.lib.styles import ParagraphStyle
from fontTools.ttLib import TTFont as Font
from fontTools.varLib.instancer import instantiateVariableFont
root = pathlib.Path(__file__).resolve().parents[1]
mobile = '--mobile' in sys.argv
width, height, margin = (420, 760, 38) if mobile else (792, 650, 90)
manifest = json.loads((root / 'public/paper-sample.json').read_text())
with tempfile.TemporaryDirectory() as tmp:
    for name, source in [('Book', 'Literata-VF.ttf'), ('BookItalic', 'Literata-Italic-VF.ttf')]:
        font = Font(root / 'public/fonts' / source)
        static = instantiateVariableFont(font, {axis.axisTag: (400 if axis.axisTag == 'wght' else 18 if axis.axisTag == 'opsz' else axis.defaultValue) for axis in font['fvar'].axes}, inplace=False)
        target = pathlib.Path(tmp) / (name + '.ttf'); static.save(target)
        pdfmetrics.registerFont(TTFont(name, str(target)))
    path = root / ('public/paper-reading-copy-mobile.pdf' if mobile else 'public/paper-reading-copy.pdf')
    c = canvas.Canvas(str(path), pagesize=(width, height))
    c.setTitle('The Quiet Hour - reading copy')
    style = ParagraphStyle('body', fontName='Book', fontSize=17, leading=25 if mobile else 28, textColor='#302d27')
    groups = [
        [' '.join(s['text'] for s in manifest['voices'][0]['sentences'] if s['paragraph'] == group) for group in [0, 1]],
        ["The door was not locked. That was the first surprise, and it reorganised the others behind it. She had prepared for a lock, had a crowbar in the boot of the car and a story ready for anyone who asked, and instead the handle turned with the small mechanical courtesy of a thing that has been waiting.",
         "Inside, the air was colder than the air outside, which she had not expected and could not immediately explain. Salt had got into everything. The stairs went up in a spiral so tight it felt less like climbing than like being screwed slowly into the sky, and by the fourth turn she had lost any sense of which way the sea lay."]
    ]
    for page, paragraphs in enumerate(groups):
        c.setFillColorRGB(.188,.176,.153)
        c.setFont('Book', 13); c.drawCentredString(width / 2, height - 42, 'The Quiet Hour')
        c.setFont('Book', 27); c.drawCentredString(width / 2, height - 104, 'Chapter One')
        y = height - 155
        for text in paragraphs:
            paragraph = Paragraph(text, style)
            _, text_height = paragraph.wrap(width - 2 * margin, height)
            paragraph.drawOn(c, margin, y - text_height)
            y -= text_height + 24
        c.setFont('Book', 12); c.drawCentredString(width / 2, 32, str(page + 1))
        c.showPage()
    c.save()
print(f'Created {path.name} with two readable excerpt pages.')

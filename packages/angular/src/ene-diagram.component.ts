import { isPlatformBrowser } from "@angular/common";
import {
  type AfterViewInit,
  booleanAttribute,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  type ElementRef,
  EventEmitter,
  Input,
  type OnChanges,
  type OnDestroy,
  Output,
  PLATFORM_ID,
  ViewChild,
  inject,
} from "@angular/core";
import { mount, type Mounted, type MountOptions, type Player } from "@ene-diagram/player";

/**
 * `<ene-diagram [source]="text" />`: an ene player (standalone). On the server and before the player is ready it shows
 * the source text in a `<pre class="ene-source">`.
 *
 * Changing `choices` picks other branch arms without rebuilding; without it, the viewer's picks are kept across source
 * changes.
 */
@Component({
  selector: "ene-diagram",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "ene-diagram" },
  template: `<pre class="ene-source" [hidden]="shown">{{ source }}</pre><div class="ene-host" #host></div>`,
})
export class EneDiagramComponent implements AfterViewInit, OnChanges, OnDestroy {
  /** The diagram text */
  @Input({ required: true }) source = "";
  @Input() lang: MountOptions["lang"];
  @Input({ transform: booleanAttribute }) autoplay = true;
  @Input({ transform: booleanAttribute }) loop = true;
  @Input() focus: MountOptions["focus"] = "auto";
  @Input() theme: MountOptions["theme"];
  @Input() choices: number[] | undefined;
  @Input() include: MountOptions["include"];

  /** The player after each render (undefined when the source has errors) */
  @Output() readonly ready = new EventEmitter<Player | undefined>();
  /** The viewer picked another branch arm */
  @Output() readonly choicesChange = new EventEmitter<number[]>();
  /** A render threw */
  @Output() readonly renderError = new EventEmitter<unknown>();

  @ViewChild("host", { static: true }) private host!: ElementRef<HTMLDivElement>;
  /** True once the player (or its diagnostics) replaced the source text */
  protected shown = false;
  private mounted: Mounted | undefined;
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly cdr = inject(ChangeDetectorRef);

  ngAfterViewInit(): void {
    if (this.browser) this.mounted = mount(this.host.nativeElement, this.source, this.options());
  }

  ngOnChanges(): void {
    this.mounted?.update(this.source, this.options());
  }

  ngOnDestroy(): void {
    this.mounted?.destroy();
    this.mounted = undefined;
  }

  private options(): MountOptions {
    return {
      lang: this.lang,
      autoplay: this.autoplay,
      loop: this.loop,
      focus: this.focus,
      theme: this.theme,
      include: this.include,
      choices: this.choices ? [...this.choices] : undefined,
      onChoicesChange: (c) => this.choicesChange.emit(c),
      onReady: (p) => {
        this.shown = true;
        this.cdr.markForCheck();
        this.ready.emit(p);
      },
      onError: (e) => {
        this.shown = false;
        this.cdr.markForCheck();
        this.renderError.emit(e);
      },
    };
  }
}

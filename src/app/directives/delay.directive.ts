import { Directive, Input, OnInit, TemplateRef, ViewContainerRef } from '@angular/core';
import { timer } from 'rxjs';

@Directive({
  selector: '[appDelay]'
})
export class DelayDirective implements OnInit {

  @Input() appDelay: any;

  constructor(private templateRef: TemplateRef<any>, private viewContainerRef: ViewContainerRef) { }

  ngOnInit(): void {
    timer(this.appDelay)
      .subscribe(() => this.viewContainerRef.createEmbeddedView(this.templateRef))
  }

}

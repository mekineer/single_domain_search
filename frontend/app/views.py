from django.shortcuts import render

def search(request):
	if request.method == 'POST':
		text = request.POST.get('search')
		cb1 = request.POST.get('cb1')
		cb2 = request.POST.get('cb2')
		cb3 = request.POST.get('cb3')
		print(text,cb1,cb2,cb3)
	return render(request,'app/search.html')

from rest_framework import viewsets
from app.models import QueryInfo
from .serializers import *
from django.db.models import Q
from rest_framework.response import Response
from rest_framework import status
from django.http import Http404

class QueryInfoViewSet(viewsets.ModelViewSet):
	serializer_class = QueryInfoSerializer
	queryset = QueryInfo.objects.all() 

	def list(self, request):
		query = self.request.query_params.get('query')
		queryset = QueryInfo.objects.filter(Q(query__icontains=query) & Q(mark = '1'))
		serializer = QueryInfoSerializer(queryset, many=True)
		return Response(serializer.data)

	def destroy(self, request, *args, **kwargs):
		try:
			instance = self.get_object()
			self.perform_destroy(instance)
		except Http404:
			pass
		return Response({"msg":"Deleted successfully",
						"status":status.HTTP_200_OK}
						)

	def update(self, request, *args, **kwargs):
		instance = self.get_object()
		serializer = self.get_serializer(instance, data=request.data)
		serializer.is_valid(raise_exception=True)
		self.perform_update(serializer)
		return Response(serializer.data)
